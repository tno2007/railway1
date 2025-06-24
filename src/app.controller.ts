import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Index } from './entities/index.entity';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private dataSource: DataSource,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // get all indexes from db
  @Get('indexes')
  async getIndexes() {
    const indexRepository = this.dataSource.getRepository(Index);
    const indices = await indexRepository.find();
    return indices.map((index) => ({
      symbol: index.symbol,
      investingSymbol: index.investingSymbol,
      investingUrlName: index.investingUrlName,
      created: index.created,
    }));
  }
}
