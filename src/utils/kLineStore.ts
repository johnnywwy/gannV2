export type StoredKLineSymbol = {
  ticker: string;
};

let activeSymbol: StoredKLineSymbol | null = null;

export function saveKLineActiveSymbol(symbol: StoredKLineSymbol) {
  activeSymbol = { ticker: symbol.ticker };
}

export function readKLineActiveSymbol() {
  return activeSymbol;
}
