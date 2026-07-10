'use strict';

const { getConfidenceRating } = require('./MatchScore');

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
      const reasons = Array.isArray(result.reasons)
        ? result.reasons.map(String)
        : (result.reason ? [String(result.reason)] : []);
      const confidence = Number(result.confidence || 0);

      return {
        parser,
        confidence,
        reason: result.reason || reasons.join(', '),
        reasons,
        rating: result.rating || getConfidenceRating(confidence),
      };
    }

    const confidence = parser.canHandle(advertisement) ? 50 : 0;
    return {
      parser,
      confidence,
      reason: confidence ? 'legacy-canHandle' : '',
      reasons: confidence ? ['legacy-canHandle'] : [],
      rating: getConfidenceRating(confidence),
    };
  }

  getParserCandidates(advertisement, { includeZero = false, driverId = null } = {}) {
    return this.parsers
      .filter(parser => !driverId || parser.driverId === driverId)
      .map(parser => this.matchParser(parser, advertisement))
      .filter(match => includeZero || match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .map(match => ({
        parserId: match.parser.id || null,
        driverId: match.parser.driverId || null,
        confidence: match.confidence,
        reason: match.reason,
        reasons: match.reasons,
        rating: match.rating,
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
      matchReasons: match.reasons,
      matchRating: match.rating,
    };
  }

  parseAll(advertisements, driverId = null) {
    return advertisements
      .map(advertisement => ({ advertisement, decoded: this.parse(advertisement, driverId) }))
      .filter(item => Boolean(item.decoded));
  }

}

module.exports = ParserRegistry;