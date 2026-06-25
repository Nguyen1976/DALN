import { Injectable } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'
import {
  ConversationMemberRepository,
  ConversationRepository,
  MessageRepository,
  PollRepository,
} from '../repositories'
import { ChatErrors } from '../errors/chat.errors'
import { conversationType } from '../generated'
import { ChatEventsPublisher } from '../rmq/publishers/chat-events.publisher'
import { MessageService } from './message.service'

export interface CreatePollRequest {
  conversationId: string
  question: string
  options: string[]
  isMultipleChoice: boolean
  userId: string
}

export interface SubmitPollVoteRequest {
  pollId: string
  optionIds: string[]
  userId: string
}

export interface ClosePollRequest {
  pollId: string
  userId: string
}

@Injectable()
export class PollService {
  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly memberRepo: ConversationMemberRepository,
    private readonly messageRepo: MessageRepository,
    private readonly pollRepo: PollRepository,
    private readonly eventsPublisher: ChatEventsPublisher,
    private readonly messageService: MessageService,
  ) {}

  async createPoll(data: CreatePollRequest) {
    const conversation = await this.conversationRepo.findById(
      data.conversationId,
    )

    if (!conversation) {
      ChatErrors.conversationNotFound()
    }

    if (conversation.type !== conversationType.GROUP) {
      ChatErrors.pollNotAllowedInDirectChat()
    }

    const member = await this.memberRepo.findByConversationIdAndUserId(
      data.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const question = String(data.question || '').trim()
    if (!question || question.length > 200) {
      ChatErrors.invalidPollPayload(
        'Poll question is required and max 200 chars',
      )
    }

    const normalizedOptions = data.options
      .map((item) => String(item || '').trim())
      .filter(Boolean)

    const uniqueOptionMap = new Map<string, string>()
    for (const option of normalizedOptions) {
      const normalizedKey = option.toLowerCase()
      if (uniqueOptionMap.has(normalizedKey)) {
        ChatErrors.invalidPollPayload('Poll options must be unique')
      }
      uniqueOptionMap.set(normalizedKey, option)
    }

    if (uniqueOptionMap.size < 2) {
      ChatErrors.invalidPollPayload('Poll must contain at least 2 options')
    }

    const poll = await this.pollRepo.create({
      question,
      isMultipleChoice: Boolean(data.isMultipleChoice),
      options: Array.from(uniqueOptionMap.values()).map((text) => ({
        id: uuidv4(),
        text,
        count: 0,
      })),
    })

    const createdMessage: any = await this.messageRepo.create({
      conversationId: data.conversationId,
      senderId: data.userId,
      type: 'POLL',
      content: question,
      pollId: poll.id,
      medias: [],
    })

    const conversationMembers = await this.memberRepo.findByConversationId(
      data.conversationId,
    )

    const senderMember = conversationMembers.find(
      (item) => item.userId === data.userId,
    )

    createdMessage.senderMember = senderMember

    const { message: normalizedMessage } =
      this.messageService.notifyMessageCreated({
        conversationId: data.conversationId,
        senderId: data.userId,
        message: createdMessage,
        senderMember: senderMember || { userId: data.userId },
        memberIds: conversationMembers.map((item) => item.userId),
      })

    if (!normalizedMessage) {
      ChatErrors.invalidMessagePayload()
    }

    return {
      message: normalizedMessage,
      poll: normalizedMessage.poll,
    }
  }

  async submitPollVote(data: SubmitPollVoteRequest) {
    const poll = await this.pollRepo.findById(data.pollId)

    if (!poll) {
      ChatErrors.pollNotFound()
    }

    if (poll.isClosed) {
      ChatErrors.pollAlreadyClosed()
    }

    const message = await this.pollRepo.findMessageByPollId(data.pollId)

    if (!message) {
      ChatErrors.pollNotFound()
    }

    const member = await this.memberRepo.findByConversationIdAndUserId(
      message.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const submittedOptionIds = Array.from(
      new Set((data.optionIds || []).filter(Boolean)),
    )

    if (!submittedOptionIds.length) {
      ChatErrors.invalidPollPayload('You must select at least one option')
    }

    if (!poll.isMultipleChoice && submittedOptionIds.length > 1) {
      ChatErrors.invalidPollPayload('This poll allows only one choice')
    }

    const validOptionIds = new Set((poll.options || []).map((opt) => opt.id))
    const allValid = submittedOptionIds.every((optionId) =>
      validOptionIds.has(optionId),
    )

    if (!allValid) {
      ChatErrors.invalidPollPayload('Invalid poll option selected')
    }

    const existingVote = await this.pollRepo.findVote(data.pollId, data.userId)
    const previousOptionIds = existingVote?.optionIds || []

    const previousSet = new Set(previousOptionIds)
    const nextSet = new Set(submittedOptionIds)

    const removedOptionIds = previousOptionIds.filter((id) => !nextSet.has(id))
    const addedOptionIds = submittedOptionIds.filter(
      (id) => !previousSet.has(id),
    )

    await this.pollRepo.upsertVote(data.pollId, data.userId, submittedOptionIds)

    await Promise.all([
      ...removedOptionIds.map((optionId) =>
        this.pollRepo.incrementOptionCountAtomic(data.pollId, optionId, -1),
      ),
      ...addedOptionIds.map((optionId) =>
        this.pollRepo.incrementOptionCountAtomic(data.pollId, optionId, 1),
      ),
    ])

    const updatedPoll = await this.pollRepo.findById(data.pollId)

    if (!updatedPoll) {
      ChatErrors.pollNotFound()
    }

    const totalVoters = await this.pollRepo.countVotes(data.pollId)
    const conversationMembers = await this.memberRepo.findByConversationId(
      message.conversationId,
    )

    this.eventsPublisher.publishPollUpdated(
      {
        pollId: data.pollId,
        messageId: message.id,
        conversationId: message.conversationId,
        question: updatedPoll.question,
        isMultipleChoice: Boolean(updatedPoll.isMultipleChoice),
        isClosed: Boolean(updatedPoll.isClosed),
        closedAt: updatedPoll.closedAt
          ? updatedPoll.closedAt.toISOString()
          : null,
        options: (updatedPoll.options || []).map((option) => ({
          id: option.id,
          text: option.text,
          count: Number(option.count || 0),
        })),
        totalVoters,
      },
      conversationMembers.map((item) => item.userId),
    )

    return {
      pollId: updatedPoll.id,
      messageId: message.id,
      conversationId: message.conversationId,
      options: (updatedPoll.options || []).map((option) => ({
        id: option.id,
        text: option.text,
        count: Number(option.count || 0),
      })),
      isClosed: Boolean(updatedPoll.isClosed),
      closedAt: updatedPoll.closedAt
        ? updatedPoll.closedAt.toISOString()
        : null,
      userVoteOptionIds: submittedOptionIds,
      totalVoters,
    }
  }

  async closePoll(data: ClosePollRequest) {
    const poll = await this.pollRepo.findById(data.pollId)

    if (!poll) {
      ChatErrors.pollNotFound()
    }

    const message = await this.pollRepo.findMessageByPollId(data.pollId)

    if (!message) {
      ChatErrors.pollNotFound()
    }

    if (poll.isClosed) {
      return {
        pollId: poll.id,
        messageId: message.id,
        conversationId: message.conversationId,
        isClosed: true,
        closedAt: poll.closedAt
          ? poll.closedAt.toISOString()
          : new Date().toISOString(),
      }
    }

    if (String(message.senderId) !== String(data.userId)) {
      ChatErrors.pollCreatorOnly()
    }

    const member = await this.memberRepo.findByConversationIdAndUserId(
      message.conversationId,
      data.userId,
    )

    if (!member) {
      ChatErrors.userNotMember()
    }

    const closedAt = new Date()
    const updatedPoll = await this.pollRepo.closePoll(data.pollId, closedAt)
    const conversationMembers = await this.memberRepo.findByConversationId(
      message.conversationId,
    )

    this.eventsPublisher.publishPollClosed(
      {
        pollId: data.pollId,
        messageId: message.id,
        conversationId: message.conversationId,
        question: updatedPoll.question,
        isMultipleChoice: Boolean(updatedPoll.isMultipleChoice),
        isClosed: true,
        closedAt: closedAt.toISOString(),
        options: (updatedPoll.options || []).map((option) => ({
          id: option.id,
          text: option.text,
          count: Number(option.count || 0),
        })),
      },
      conversationMembers.map((item) => item.userId),
    )

    return {
      pollId: updatedPoll.id,
      messageId: message.id,
      conversationId: message.conversationId,
      isClosed: true,
      closedAt: closedAt.toISOString(),
    }
  }
}
