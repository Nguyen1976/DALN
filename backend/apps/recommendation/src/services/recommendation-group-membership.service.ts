import { Injectable } from '@nestjs/common'
import { Neo4jService } from '@app/neo4j/neo4j.service'

@Injectable()
export class RecommendationGroupMembershipService {
  constructor(private readonly neo4jService: Neo4jService) {}

  async onUserJoinedGroup(payload: {
    userId: string
    groupId: string
    conversationId?: string
    groupName?: string
    createdAt?: string
  }): Promise<void> {
    const { userId, groupId, groupName } = payload

    const cypher = `
      MERGE (g:Group {conversationId: $groupId})
      SET g.name = coalesce($groupName, g.name), g.updatedAt = timestamp()
      MERGE (u:User {userId: $userId})
      MERGE (u)-[r:MEMBER_OF]->(g)
      RETURN g, u
    `

    try {
      await this.neo4jService.write(cypher, { userId, groupId, groupName })
    } catch (e) {
      console.warn('[recommendation] neo4j upsert group membership failed', e)
    }
  }

  async onUserLeftGroup(payload: {
    userId: string
    groupId: string
    conversationId?: string
    leftAt?: string
  }): Promise<void> {
    const { userId, groupId } = payload

    const cypher = `
      MATCH (u:User {userId: $userId})-[r:MEMBER_OF]->(g:Group {conversationId: $groupId})
      DELETE r
    `

    try {
      await this.neo4jService.write(cypher, { userId, groupId })
    } catch (e) {
      console.warn('[recommendation] neo4j remove group membership failed', e)
    }
  }
}
