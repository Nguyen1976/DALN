import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from 'apps/chat/prisma/prisma.service'

export type PollOptionInput = {
  id: string
  text: string
  count: number
}

@Injectable()
export class PollRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(data: {
    question: string
    isMultipleChoice: boolean
    options: PollOptionInput[]
  }) {
    return await this.prisma.poll.create({
      data: {
        question: data.question,
        isMultipleChoice: data.isMultipleChoice,
        options: data.options,
      },
    })
  }

  async findById(pollId: string) {
    return await this.prisma.poll.findUnique({
      where: {
        id: pollId,
      },
    })
  }

  async findVote(pollId: string, userId: string) {
    return await this.prisma.pollVote.findUnique({
      where: {
        pollId_userId: {
          pollId,
          userId,
        },
      },
    })
  }

  async upsertVote(pollId: string, userId: string, optionIds: string[]) {
    return await this.prisma.pollVote.upsert({
      where: {
        pollId_userId: {
          pollId,
          userId,
        },
      },
      update: {
        optionIds,
      },
      create: {
        pollId,
        userId,
        optionIds,
      },
    })
  }

  async countVotes(pollId: string) {
    return await this.prisma.pollVote.count({
      where: {
        pollId,
      },
    })
  }

  async findMessageByPollId(pollId: string) {
    return await this.prisma.message.findFirst({
      where: {
        pollId,
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
      },
    })
  }

  async closePoll(pollId: string, closedAt: Date) {
    return await this.prisma.poll.update({
      where: {
        id: pollId,
      },
      data: {
        isClosed: true,
        closedAt,
      },
    })
  }

  async incrementOptionCountAtomic(
    pollId: string,
    optionId: string,
    delta: number,
  ) {
    if (!delta) return

    await this.prisma.$runCommandRaw({
      update: 'poll',
      updates: [
        {
          q: {
            _id: { $oid: pollId },
            'options.id': optionId,
          },
          u: {
            $inc: {
              'options.$.count': delta,
            },
          },
        },
      ],
    })
  }
}
