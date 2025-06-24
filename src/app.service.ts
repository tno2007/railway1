import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MarketIndex } from './typings/MarketIndex';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource, In } from 'typeorm';
import { Index } from './entities/index.entity';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  constructor(private dataSource: DataSource) {
    // Initialize the index data when the service is created
    this.initializeIndexData()
      .then(() => console.log('Index data initialized successfully'))
      .catch((error) => console.error('Error initializing index data:', error));
  }

  initializeIndexData = async () => {
    // get data from file ~/src/data/indexes.json
    const indicesData: MarketIndex[] = JSON.parse(
      fs.readFileSync(path.join('./src', 'data', 'indexData.json'), 'utf-8'),
    );

    // create an array of index symbols from the indicesData
    const indexSymbols = indicesData.map((data) => data.yahooFinanceSymbol);

    // check if the indices already exist in the database
    const indexRepository = this.dataSource.getRepository(Index);
    const indices = await indexRepository.find({
      where: {
        symbol: In(indexSymbols),
      },
    });

    // for the indexes not found in the database, create them
    const indicesToCreate = indexSymbols.filter(
      (symbol) => !indices.some((index: any) => index.symbol === symbol),
    );

    // if there are no indices to create, return
    const indicesToCreateData = indicesData.filter((data) =>
      indicesToCreate.includes(data.yahooFinanceSymbol),
    );

    // if there are indices to create, create them

    const indicesToCreateEntities = indicesToCreateData.map((data) => {
      const index = new Index();
      index.symbol = data.yahooFinanceSymbol;
      index.investingSymbol = data.investingSymbol;
      index.investingUrlName = data.investingUrlName;
      index.created = new Date().getTime();

      return index;
    });

    await indexRepository.save(indicesToCreateEntities);
  };

  onModuleInit() {
    console.log('AppService initialized');
  }

  onModuleDestroy() {
    console.log('AppService destroyed');
  }

  getHello(): string {
    return 'Hello World!';
  }
}
