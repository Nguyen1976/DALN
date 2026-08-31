import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { Global, Module } from '@nestjs/common'
import { EXCHANGE_RMQ } from 'libs/constant/rmq/exchange'

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      // Khai báo mọi exchange service này chạm tới (publish lẫn subscribe),
      // không chỉ exchange nó sở hữu. Khai báo topic exchange là idempotent,
      // nên trùng với service khác vẫn an toàn và loại bỏ phụ thuộc thứ tự
      // khởi động (bind vào exchange chưa tồn tại -> 404 NOT_FOUND -> app chết).
      exchanges: [
        { name: EXCHANGE_RMQ.CHAT_EVENTS, type: 'topic' },
        { name: EXCHANGE_RMQ.SAGA_EVENTS, type: 'topic' },
        { name: EXCHANGE_RMQ.USER_EVENTS, type: 'topic' },
        { name: EXCHANGE_RMQ.REALTIME_EVENTS, type: 'topic' },
      ],
      uri: process.env.RABBITMQ_URL || 'amqp://user:user@localhost:5672',
      connectionInitOptions: { wait: true },
      // Mặc định của golevelup là 10. golevelup chỉ ack SAU khi handler resolve,
      // nên prefetch chính là số tin tối đa đang xử lý cùng lúc — cũng là trần
      // của buffer trong MessageBatchWriter. Để 10 thì lô 100 không bao giờ đầy,
      // luôn phải chờ hết linger 20ms rồi ghi vỏn vẹn 10 tin: batching vô nghĩa.
      //
      // Nâng lên 300 (~3x kích thước lô) chỉ an toàn KHI có batching: 300 tin
      // đang bay không tạo ra 300 lệnh Prisma song song (đo được là càng song
      // song Prisma càng đắt: 4,1ms CPU/tin ở mức 10, 6,9ms ở mức 50) mà nằm
      // chờ trong buffer rồi gộp thành 3 lệnh createMany.
      prefetchCount: Number(process.env.CHAT_RMQ_PREFETCH ?? 300),
    }),
  ],
  exports: [RabbitMQModule],
})
export class RmqModule {}
