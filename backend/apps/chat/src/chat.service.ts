import { Injectable } from '@nestjs/common'
import type {
  CallEndedPayload,
  MessageSendPayload,
  UserUpdatedPayload,
  UserUpdateStatusMakeFriendPayload,
  UpdateMessageReadPayload,
} from 'libs/constant/rmq/payload'
import { ConversationAssetKind } from './http/chat-http.dto'
import {
  MessageService,
  PollService,
  ConversationMemberService,
  ConversationService,
  type ClearConversationHistoryRequest,
  type DeleteMessageForMeRequest,
  type RevokeMessageRequest,
  type CreatePollRequest,
  type SubmitPollVoteRequest,
  type ClosePollRequest,
  type AddMemberToConversationRequest,
  type RemoveMemberFromConversationRequest,
  type LeaveConversationRequest,
  type CreateConversationData,
  type DeleteConversationRequest,
} from './services'

@Injectable()
export class ChatService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly pollService: PollService,
    private readonly conversationMemberService: ConversationMemberService,
  ) {}

  createConversationWhenAcceptFriend(data: UserUpdateStatusMakeFriendPayload) {
    return this.conversationService.createConversationWhenAcceptFriend(data)
  }

  createConversation(data: CreateConversationData) {
    return this.conversationService.createConversation(data)
  }

  sendMessage(data: MessageSendPayload) {
    return this.messageService.sendMessage(data)
  }

  createMessageUploadUrl(data: Parameters<MessageService['createMessageUploadUrl']>[0]) {
    return this.messageService.createMessageUploadUrl(data)
  }

  addMemberToConversation(dto: AddMemberToConversationRequest) {
    return this.conversationMemberService.addMemberToConversation(dto)
  }

  removeMemberFromConversation(dto: RemoveMemberFromConversationRequest) {
    return this.conversationMemberService.removeMemberFromConversation(dto)
  }

  leaveConversation(dto: LeaveConversationRequest) {
    return this.conversationMemberService.leaveConversation(dto)
  }

  deleteConversation(dto: DeleteConversationRequest) {
    return this.conversationService.deleteConversation(dto)
  }

  getConversations(userId: string, params: any) {
    return this.conversationService.getConversations(userId, params)
  }

  getMessagesByConversationId(
    conversationId: string,
    userId: string,
    params: any,
  ) {
    return this.messageService.getMessagesByConversationId(
      conversationId,
      userId,
      params,
    )
  }

  createPoll(data: CreatePollRequest) {
    return this.pollService.createPoll(data)
  }

  submitPollVote(data: SubmitPollVoteRequest) {
    return this.pollService.submitPollVote(data)
  }

  closePoll(data: ClosePollRequest) {
    return this.pollService.closePoll(data)
  }

  revokeMessage(data: RevokeMessageRequest) {
    return this.messageService.revokeMessage(data)
  }

  deleteMessageForMe(data: DeleteMessageForMeRequest) {
    return this.messageService.deleteMessageForMe(data)
  }

  clearConversationHistory(data: ClearConversationHistoryRequest) {
    return this.messageService.clearConversationHistory(data)
  }

  recordCallOutcome(data: CallEndedPayload) {
    return this.messageService.recordCallOutcome(data)
  }

  getConversationAssets(
    conversationId: string,
    userId: string,
    kind: ConversationAssetKind,
    params: any,
  ) {
    return this.messageService.getConversationAssets(
      conversationId,
      userId,
      kind,
      params,
    )
  }

  handleUserUpdated(data: UserUpdatedPayload) {
    return this.conversationService.handleUserUpdated(data)
  }

  updateMessageRead(data: UpdateMessageReadPayload) {
    return this.messageService.updateMessageRead(data)
  }

  searchConversations(userId: string, keyword: string) {
    return this.conversationService.searchConversations(userId, keyword)
  }

  getConversationByFriendId(friendId: string, userId: string) {
    return this.conversationService.getConversationByFriendId(friendId, userId)
  }

  getConversationById(conversationId: string, userId: string) {
    return this.conversationService.getConversationById(conversationId, userId)
  }
}
