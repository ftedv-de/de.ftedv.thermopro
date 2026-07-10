'use strict';

const { getConfidenceRating } = require('./MatchScore');

const DRIVER_MANUFACTURERS = Object.freeze({
  ThermoBeaconDriver: { id: 'thermobeacon', name: 'ThermoBeacon' },
  ThermoProTHDriver: { id: 'thermopro', name: 'ThermoPro' },
  MiFloraDriver: { id: 'xiaomi', name: 'Xiaomi / HHCC' },
  GoveeTHDriver: { id: 'govee', name: 'Govee' },
});

function getParserMetadata(parser) {
  const inferred = DRIVER_MANUFACTURERS[parser?.driverId] || {};
  return {
    manufacturerId: parser?.manufacturerId || inferred.id || 'unknown',
    manufacturerName: parser?.manufacturerName || inferred.name || 'Unknown',
    protocolId: parser?.protocolId || parser?.id || 'unknown',
  };
}

class ParserRegistry {

  constructor(parsers = []) {
    this.parsers = [];
    this.parsersByManufacturer = new Map();

    for (const parser of parsers) this.register(parser);
  }

  register(parser) {
    if (!parser || typeof parser.parse !== 'function') {
      throw new Error('Parser must implement parse(advertisement)');
    }
    if (typeof parser.match !== 'function' && typeof parser.canHandle !== 'function') {
      throw new Error('Parser must implement match(advertisement) or canHandle(advertisement)');
    }

    const metadata = getParserMetadata(parser);
    this.parsers.push(parser);
    if (!this.parsersByManufacturer.has(metadata.manufacturerId)) {
      this.parsersByManufacturer.set(metadata.manufacturerId, []);
    }
    this.parsersByManufacturer.get(metadata.manufacturerId).push(parser);
  }

  getParsers() {
    return [...this.parsers];
  }

  getManufacturers() {
    return Array.from(this.parsersByManufacturer.entries()).map(([manufacturerId, parsers]) => {
      const metadata = getParserMetadata(parsers[0]);
      return {
        manufacturerId,
        manufacturerName: metadata.manufacturerName,
        protocols: parsers.map(parser => getParserMetadata(parser).protocolId),
      };
    });
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
      .map(match => {
        const metadata = getParserMetadata(match.parser);
        return {
          ...metadata,
          parserId: match.parser.id || null,
          driverId: match.parser.driverId || null,
          confidence: match.confidence,
          reason: match.reason,
          reasons: match.reasons,
          rating: match.rating,
        };
      });
  }

  getManufacturerCandidates(advertisement, { includeZero = false } = {}) {
    return Array.from(this.parsersByManufacturer.entries())
      .map(([manufacturerId, parsers]) => {
        const protocolCandidates = parsers
          .map(parser => this.matchParser(parser, advertisement))
          .sort((a, b) => b.confidence - a.confidence);
        const best = protocolCandidates[0];
        const metadata = getParserMetadata(best?.parser || parsers[0]);
        return {
          manufacturerId,
          manufacturerName: metadata.manufacturerName,
          confidence: best?.confidence || 0,
          rating: best?.rating || getConfidenceRating(0),
          bestProtocolId: best ? getParserMetadata(best.parser).protocolId : null,
          protocols: protocolCandidates.map(candidate => ({
            protocolId: getParserMetadata(candidate.parser).protocolId,
            parserId: candidate.parser.id || null,
            confidence: candidate.confidence,
            reason: candidate.reason,
            reasons: candidate.reasons,
            rating: candidate.rating,
          })),
        };
      })
      .filter(candidate => includeZero || candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
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
    const metadata = getParserMetadata(parser);

    return {
      ...decoded,
      manufacturerId: decoded.manufacturerId || metadata.manufacturerId,
      manufacturer: decoded.manufacturer || metadata.manufacturerName,
      protocolId: decoded.protocolId || metadata.protocolId,
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