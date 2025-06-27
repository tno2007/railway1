import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MarketIndex } from './typings/MarketIndex';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource, In } from 'typeorm';
import { Index } from './entities/index.entity';
import { Stock } from './entities/stock.entity';
import { Browser, chromium, LaunchOptions } from 'playwright';
import { MarketSymbol } from './typings/MarketSymbol';
import { LogEntry } from './entities/logentry.entity';
import { SymbolMapping } from './typings/SymbolMapping';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import * as cheerio from 'cheerio';

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

  async getStocksFromCsv(
    csvUrl: string,
    mapping: SymbolMapping,
    outputPath: string = path.join(
      './src',
      'output',
      new Date().toISOString().replace(/[:.]/g, '-') + '.json',
    ),
  ): Promise<MarketSymbol[]> {
    try {
      // Fetch the CSV from GitHub
      const response = await axios.get(csvUrl);
      const csv = response.data;

      // Parse CSV content synchronously
      const records: any[] = parse(csv, {
        columns: true,
        skip_empty_lines: true,
      });

      // Map the records to the desired format
      // skip if symbolKey is empty or contains spaces
      const symbols: MarketSymbol[] = records
        .filter(
          (record) =>
            record[mapping.symbolKey] && !/\s/.test(record[mapping.symbolKey]),
        )
        .map((record) => {
          const symbol: MarketSymbol = {
            symbol: record[mapping.symbolKey].trim(),
            name: record[mapping.nameKey]?.trim() || '',
          };
          return symbol;
        });

      // write the symbols to a file ~/src/data/symbols.json
      // fs.writeFileSync(outputPath, JSON.stringify(symbols, null, 2));

      return symbols;
    } catch (err) {
      console.error(
        'getStocksFromCsv - Failed to fetch or parse CSV :',
        err.message,
      );
      return [];
    }
  }

  async getStocksFromWikipedia(
    url: string,
    tableCssPath: string,
    mapping: SymbolMapping,
  ): Promise<MarketSymbol[]> {
    try {
      // this.dataSource.getRepository(LogEntry).save({
      //   level: 'info',
      //   message: 'Fetching data from Wikipedia: ' + url,
      //   context: 'getStocksFromWikipedia',
      // });

      // Fetch the HTML content from the URL
      const response = await axios.get(url);
      const html = response.data;

      // Load the HTML into Cheerio
      const $ = cheerio.load(html);

      // Find the table using the provided CSS path
      const table = $(tableCssPath);

      // Extract headers
      const headers: string[] = [];
      table
        .find('tr')
        .first()
        .find('th')
        .each((i, el) => {
          headers.push($(el).text().trim());
        });

      // Extract rows
      const stocks: MarketSymbol[] = [];
      table
        .find('tr')
        .slice(1)
        .each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length === headers.length) {
            const stock: MarketSymbol = {
              symbol: '',
              name: '',
            };
            cells.each((j, cell) => {
              // if this cell is the symbol cell, use the mapping to get the symbol
              if (headers[j] === mapping.symbolKey) {
                stock.symbol = $(cell).text().trim();
              }
              // if this cell is the name cell, use the mapping to get the name
              if (headers[j] === mapping.nameKey) {
                stock.name = $(cell).text().trim();
              }
            });
            stocks.push(stock);
          }
        });

      return stocks;
    } catch (err) {
      console.error('Failed to fetch or parse Wikipedia:', err.message);
      return [];
    }
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

  initializeIndexStockData = async () => {
    const IndexesJsonData: MarketIndex[] = JSON.parse(
      fs.readFileSync(path.join('./src', 'data', 'indexData.json'), 'utf-8'),
    );

    // loop through each index and if the stockListSourceType is 'csv', fetch the CSV and save the stocks to the database
    for (const jsonIndex of IndexesJsonData) {
      const stockConfig = jsonIndex.stockConfig;

      // verify that stocks have already been fetched for this index
      const stockRepository = this.dataSource.getRepository(Stock);
      const existingStocks = await stockRepository.find({
        where: { index: { symbol: jsonIndex.yahooFinanceSymbol } },
      });

      if (existingStocks.length > 0) {
        this.dataSource.getRepository(LogEntry).save({
          level: 'info',
          message: `Stocks for index ${jsonIndex.yahooFinanceSymbol} already exist in the database. Skipping.`,
          context: 'initializeIndexStockData',
        });
        continue; // Skip to the next index if stocks already exist
      }

      let stocks: MarketSymbol[] = [];

      // switch based on the stockListSourceType
      switch (stockConfig.sourceType) {
        case 'csv': {
          const mapping: SymbolMapping = {
            symbolKey: stockConfig.symbolKey,
            nameKey: stockConfig.nameKey,
          };

          // Fetch stocks from CSV
          stocks = await this.getStocksFromCsv(stockConfig.sourceUrl, mapping);

          break;
        }

        case 'wikipedia': {
          const mapping: SymbolMapping = {
            symbolKey: stockConfig.symbolKey,
            nameKey: stockConfig.nameKey,
          };

          // Fetch stocks from Wikipedia
          stocks = await this.getStocksFromWikipedia(
            stockConfig.sourceUrl,
            stockConfig.tableCssPath,
            mapping,
          );

          break;
        }
      }

      // Save stocks to the database
      const indexRepository = this.dataSource.getRepository(Index);
      const index = await indexRepository.findOne({
        where: { symbol: jsonIndex.yahooFinanceSymbol },
      });

      if (!index) {
        this.dataSource.getRepository(LogEntry).save({
          level: 'error',
          message: `Index ${jsonIndex.yahooFinanceSymbol} not found in the database. Skipping.`,
          context: 'initializeIndexStockData',
        });
        continue;
      }

      const stockEntities = stocks.map((stock) => {
        const stockEntity = new Stock(); // Assuming you have a Stock entity
        stockEntity.symbol = stock.symbol;
        stockEntity.name = stock.name;
        stockEntity.index = index; // Set the index relation
        stockEntity.indexSymbol = index.symbol; // Set the index relation
        stockEntity.created = new Date().getTime();

        return stockEntity;
      });

      await stockRepository.save(stockEntities);
      this.dataSource.getRepository(LogEntry).save({
        level: 'info',
        message: `Stocks for index ${jsonIndex.yahooFinanceSymbol} saved successfully.`,
        context: 'initializeIndexStockData',
      });
    }
  };

  // browser initialization
  async scrape() {
    if (!this.browser) {
      this.browser = await chromium.launch(options);
    }

    const context = await this.browser.newContext(contextOptions);
    const page = await context.newPage();

    // Example of navigating to a page
    await page.goto('https://example.com', {
      waitUntil: 'domcontentloaded',
    });

    const content = await page.content();

    // Close the page and context after scraping
    await page.close();
    await context.close();
    // await this.browser.close();

    return content; // Return the scraped content or any other data you need
  }

  async onModuleInit() {
    console.log('AppService initialized');

    this.browser = await chromium.launch(options);

    console.log('Initializing index data...');
    await this.initializeIndexData();
    console.log('Index data initialized.');

    console.log('Initializing index stock data...');
    await this.initializeIndexStockData();
    console.log('Index stock data initialized.');

    // console.log('Initializing ETF data...');
    // //await this.initializeEtfData();
    // console.log('ETF data initialized.');

    // console.log('Initializing settings data...');
    // //await this.initializeCronJobs();
    // console.log('Cron jobs initialized.');
  }

  async onModuleDestroy() {
    console.log('AppService destroyed');
    if (this.browser) {
      await this.browser.close();
    }
  }

  getHello(): string {
    return 'Hello World!';
  }
}
