import type { Channel } from 'amqplib'
import {
  PARTITION_COUNT,
  SEND_EXCHANGE,
  partitionQueue,
  partitionRoutingKey,
} from 'libs/constant/rmq/partition'

/**
 * Khai báo exchange chat.send, 16 queue và binding. Idempotent; gateway và chat
 * cùng gọi lúc khởi động, nên gateway publish được kể cả khi chưa có instance
 * chat nào chạy.
 *
 * Giới hạn độ dài queue KHÔNG nằm ở đây mà ở policy `chat-send-partitions`
 * (docker/rabbitmq-init.sh): policy đổi được khi đang chạy, còn argument của
 * queue thì khai báo lại khác đi là PRECONDITION_FAILED.
 */
export async function assertSendTopology(
  channel: Pick<Channel, 'assertExchange' | 'assertQueue' | 'bindQueue'>,
): Promise<void> {
  await channel.assertExchange(SEND_EXCHANGE, 'direct', { durable: true })
  for (let p = 0; p < PARTITION_COUNT; p++) {
    await channel.assertQueue(partitionQueue(p), {
      durable: true,
      arguments: { 'x-single-active-consumer': true },
    })
    await channel.bindQueue(
      partitionQueue(p),
      SEND_EXCHANGE,
      partitionRoutingKey(p),
    )
  }
}
