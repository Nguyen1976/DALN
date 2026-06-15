import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { SagaOrchestratorModule } from './saga-orchestrator.module'

// Saga orchestrator KHÔNG nhận HTTP: chỉ giao tiếp qua RabbitMQ.
// createApplicationContext khởi tạo đầy đủ DI + lifecycle (đăng ký RabbitSubscribe
// và bật outbox relay) mà không mở cổng HTTP nào.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SagaOrchestratorModule)
  app.enableShutdownHooks()

  Logger.log('Saga Orchestrator đã khởi động (RMQ-only)', 'Bootstrap')
}
bootstrap()
