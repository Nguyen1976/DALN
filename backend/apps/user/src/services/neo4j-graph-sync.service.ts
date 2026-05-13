import { Injectable } from '@nestjs/common'
import { Neo4jService } from '@app/neo4j'
import {
  UserCreatedPayload,
  UserUpdateStatusMakeFriendPayload,
} from 'libs/constant/rmq/payload'

@Injectable()
export class Neo4jGraphSyncService {
  constructor(private readonly neo4jService: Neo4jService) {}

  async syncUserCreated(payload: UserCreatedPayload): Promise<void> {
    const props = {
      id: payload.id,
      email: payload.email,
      username: payload.username,
      lat: payload.location?.lat ?? null,
      lon: payload.location?.lon ?? null,
      isActive: true,
      updatedAt: new Date().toISOString(),
    }

    await this.neo4jService.write(
      `
      MERGE (u:User {id: $id})
      SET u += $props,
          u.createdAt = coalesce(u.createdAt, $now)
      RETURN u.id AS id
      `,
      {
        id: payload.id,
        props,
        now: new Date().toISOString(),
      },
    )
  }

  async syncFriendshipAccepted(
    payload: UserUpdateStatusMakeFriendPayload,
  ): Promise<void> {
    if (payload.status !== 'ACCEPTED') {
      return
    }

    const inviter = payload.members.find(
      (member) => member.userId === payload.inviterId,
    )
    const invitee = payload.members.find(
      (member) => member.userId === payload.inviteeId,
    )

    await this.neo4jService.write(
      `
      MERGE (inviter:User {id: $inviterId})
      SET inviter += $inviterProps
      MERGE (invitee:User {id: $inviteeId})
      SET invitee += $inviteeProps
      MERGE (inviter)-[r:FRIEND]->(invitee)
      SET r.syncedAt = $now
      MERGE (invitee)-[r2:FRIEND]->(inviter)
      SET r2.syncedAt = $now
      `,
      {
        inviterId: payload.inviterId,
        inviteeId: payload.inviteeId,
        inviterProps: {
          id: payload.inviterId,
          username: inviter?.username ?? '',
          avatar: inviter?.avatar ?? '',
          fullName: inviter?.fullName ?? '',
          updatedAt: new Date().toISOString(),
        },
        inviteeProps: {
          id: payload.inviteeId,
          username: invitee?.username ?? '',
          avatar: invitee?.avatar ?? '',
          fullName: invitee?.fullName ?? '',
          updatedAt: new Date().toISOString(),
        },
        now: new Date().toISOString(),
      },
    )
  }
}
