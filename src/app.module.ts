import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QuoteModule } from './helpers/modules/quote';
import { HistoryModule } from './helpers/modules/history';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      // im-memory
      database: ':memory:',
      // database: "./src/data/data.db",
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService, HistoryModule, QuoteModule],
})
export class AppModule {
  constructor(private dataSource: DataSource) {
    if (!this.dataSource.isInitialized) {
      this.dataSource
        .initialize()
        .then(() => {
          console.log('Data Source has been initialized!');
        })
        .catch((err) => {
          console.error('Error during Data Source initialization', err);
        });
    }
  }
}
