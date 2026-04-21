import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import neo4j,  { Driver } from 'neo4j-driver';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver!: Driver;

  async onModuleInit() {
    // Thay thế bằng thông tin từ .env của bạn
    this.driver = neo4j.driver(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'password123',
      ),
    );
    
    // Kiểm tra kết nối
    try {
      await this.driver.verifyConnectivity();
      console.log('✅ Connected to Neo4j successfully');
    } catch (error) {
      console.error('❌ Neo4j connection failed', error);
    }
  }

  // Hàm để thực thi các câu lệnh Cypher (Query đồ thị)
  async read(query: string, params?: Record<string, any>) {
    const session = this.driver.session();
    try {
      const result = await session.run(query, params);
      return result.records;
    } finally {
      await session.close();
    }
  }

  async write(query: string, params?: Record<string, any>) {
    const session = this.driver.session();
    try {
      const result = await session.run(query, params);
      return result.records;
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy() {
    await this.driver.close();
  }
}