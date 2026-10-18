export class IllegalTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTurnError";
  }
}

export class CardRulesNotImplementedError extends IllegalTurnError {
  constructor(cardType: string) {
    super(`Card rules are not implemented: ${cardType}`);
    this.name = "CardRulesNotImplementedError";
  }
}
