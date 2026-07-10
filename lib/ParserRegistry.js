'use strict';

class ParserRegistry {

  constructor(parsers = []) {
    this.parsers = [];

    for (const parser of parsers) {
      this.register(parser);
    }
  }

  register(parser) {
    if (!parser || typeof parser.parse !== 'function') {
      throw new Error('Parser must implement parse(advertisement)');
    }

    if (typeof parser.match !== 'function' && typeof parser.canHandle !== 'function') {
      throw new Error('Parser must implement match(advertisement) or canHandle(advertisement)');
    }

    this.parsers.push(parser);
  }

  getParsers() {
    return [...this.parsers];
  }

  matchParser(parser, advertisement) {
    if (typeof parser.match === 'function') {
      const result = parser.match(advertisement) || {};
      return {
        parser,
        confidence: Number(result.confidence || 0),
        reason: result.reason || '',
      };
    }

    return {
      parser,
      confidence: parser.canHandle(advertisement) ? 50 : 0,
      reason: 'legacy-canHandle',
    };
  }

  getParserCandidates(advertisement, { includeZero = false } = {}) {
    return this.parsers
      .map(parser => this.matchParser(parser, advertisement))
      .filter(match => includeZero || match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .map(match => ({
        parserId: match.parser.id || null,
        driverId: match.parser.driverId || null,
        confidence: match.confidence,
        reason: match.reason,
      }));
  }

  findParser(advertisement, driverId = null) {
    return this.parsers
      .filter(parser => !driverId || parser.driverId === driverId)
      .map(parser => this.matchParser(parser, advertisement))
      .filter(match => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)[0]?.parser || null;
  }

  parse(advertisement, driverId = null) {
    const parser = this.findParser(advertisement, driverId);
    if (!parser) return null;

    const match = this.matchParser(parser, advertisement);
    const decoded = parser.parse(advertisement);
    if (!decoded) return null;

    return {
      ...decoded,
      parserId: parser.id,
      driverId: parser.driverId,
      matchConfidence: match.confidence,
      matchReason: match.reason,
    };
  }

  parseAll(advertisements, driverId = null) {
    return advertisements
      .map(advertisement => ({ advertisement, decoded: this.parse(advertisement, driverId) }))
      .filter(item => Boolean(item.decoded));
  }

}

module.exports = ParserRegistry;
