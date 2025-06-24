import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MarketIndex } from './typings/MarketIndex';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource, In } from 'typeorm';
import { Index } from './entities/index.entity';
import { Browser, chromium, LaunchOptions } from 'playwright';

const options: LaunchOptions = {
  headless: true,
  slowMo: 100,
  // set some args to make playwright behave more like a real browser
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--allow-insecure-localhost',
  ],
  ignoreDefaultArgs: ['--enable-automation'],
};

// create an array of user agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:55.0) Gecko/20100101 Firefox/55.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
];

const contextOptions = {
  viewport: { width: 1280, height: 800 },
  userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
  deviceScaleFactor: 1,
};

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser;

  constructor(private dataSource: DataSource) {}

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

  // browser initialization
  async scrape() {
    if (!this.browser) {
      this.browser = await chromium.launch(options);
    }

    const context = await this.browser.newContext(contextOptions);
    const page = await context.newPage();

    // Example of navigating to a page
    await page.goto('https://example.com');

    // Perform scraping tasks here...

    // Close the page and context after scraping
    await page.close();
    await context.close();
  }

  async onModuleInit() {
    console.log('AppService initialized');

    // Initialize the index data when the service is created
    await this.initializeIndexData()
      .then(() => console.log('Index data initialized successfully'))
      .catch((error) => console.error('Error initializing index data:', error));

    // Initialize the browser for scraping
    await this.scrape();
  }

  onModuleDestroy() {
    console.log('AppService destroyed');
  }

  getHello(): string {
    return 'Hello World!';
  }
}
