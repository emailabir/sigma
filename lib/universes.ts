import sp500 from './universe.json';
import nasdaq100 from './nasdaq100.json';

export const universes = {
 sp500: {label: 'S&P 500', stocks: sp500, retrieved: 'Sep 9, 2026', classification: 'GICS sector', source: 'https://github.com/datasets/s-and-p-500-companies'},
 nasdaq100: {label: 'Nasdaq-100', stocks: nasdaq100, retrieved: 'Sep 10, 2026', classification: 'ICB industry', source: 'https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies'},
};
export type UniverseId = keyof typeof universes;
export const allStocks = [...new Map([...sp500, ...nasdaq100].map(stock => [stock.symbol, stock])).values()];
