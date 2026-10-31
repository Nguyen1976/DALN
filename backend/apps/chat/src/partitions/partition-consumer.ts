import type { Channel, ConsumeMessage } from 'amqplib'
import type { MessageSendPayload } from 'libs/constant/rmq/payload'
import { partitionQueue } from 'libs/constant/rmq/partition'

export type PartitionHandler = (
  payload: MessageSendPayload,
) => Promise<'ack' | 'dead-letter'>

type ConsumerChannel = Pick<
  Channel,
  'prefetch' | 'consume' | 'ack' | 'nack' | 'close' | 'on'
>

/**
 * Consumer của MỘT partition, trên channel riêng của nó — nhờ vậy nhả một
 * partition (đóng channel) không đụng tới các partition khác.
 *
 * Bàn giao (drain) theo HOLD → FINISH → CLOSE:
 *  - HOLD: tin giao tới sau khi bắt đầu drain thì không xử lý, không ack;
 *  - FINISH: chờ các tin đang xử lý ghi xong và ack;
 *  - CLOSE: đóng channel — broker trả các tin đang HOLD về ĐẦU queue, đúng thứ
 *    tự cũ, cho chủ mới.
 * Không có lúc nào hai bên cùng xử lý một partition.
 */
export class PartitionConsumer {
  private draining = false
  private closing = false
  private drained?: Promise<void>
  private lost?: () => void
  private readonly inFlight = new Set<Promise<void>>()

  private constructor(
    readonly partition: number,
    private readonly channel: ConsumerChannel,
    private readonly handler: PartitionHandler,
  ) {}

  static async start(
    source: { createChannel(): Promise<ConsumerChannel> },
    partition: number,
    handler: PartitionHandler,
    prefetch: number,
  ): Promise<PartitionConsumer> {
    const channel = await source.createChannel()
    const consumer = new PartitionConsumer(partition, channel, handler)
    // Channel đóng mà không phải do drain (mất kết nối broker): báo coordinator
    // để nó bỏ partition và giành lại ở lượt sau. 'error' luôn đi kèm 'close'.
    channel.on('close', () => {
      if (!consumer.closing) consumer.lost?.()
    })
    channel.on('error', () => undefined)
    await channel.prefetch(prefetch)
    await channel.consume(partitionQueue(partition), (msg) => {
      if (msg) consumer.onMessage(msg)
    })
    return consumer
  }

  onLost(cb: () => void): void {
    this.lost = cb
  }

  drain(): Promise<void> {
    this.drained ??= this.runDrain()
    return this.drained
  }

  private async runDrain() {
    this.draining = true
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight])
    this.closing = true
    await this.channel.close().catch(() => undefined)
  }

  private onMessage(msg: ConsumeMessage) {
    if (this.draining) return

    let payload: MessageSendPayload
    try {
      payload = JSON.parse(msg.content.toString()) as MessageSendPayload
    } catch {
      this.settle(() => this.channel.nack(msg, false, false))
      return
    }

    const job: Promise<void> = this.handler(payload)
      .then((result) =>
        this.settle(() =>
          result === 'ack'
            ? this.channel.ack(msg)
            : this.channel.nack(msg, false, false),
        ),
      )
      // Handler tự xử lý lỗi; tới đây là lỗi lập trình — đừng để tin kẹt unacked.
      .catch(() => this.settle(() => this.channel.nack(msg, false, false)))
      .finally(() => this.inFlight.delete(job))
    this.inFlight.add(job)
  }

  /** ack/nack trên channel đã chết ném lỗi; tin đó broker đã tự trả về queue. */
  private settle(op: () => void) {
    try {
      op()
    } catch {
      // bỏ qua
    }
  }
}
