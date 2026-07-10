'use strict';

const MatchWeights = Object.freeze({
  PAYLOAD: 50,
  SERVICE_UUID: 60,
  MANUFACTURER: 30,
  SERVICE_DATA: 25,
  PAYLOAD_LENGTH: 10,
  LOCAL_NAME: 10,
  MAC_PREFIX: 5,
});

function getConfidenceRating(confidence) {
  const score = Number(confidence || 0);

  if (score >= 140) {
    return { level: 'excellent', label: 'Excellent', stars: 5 };
  }

  if (score >= 100) {
    return { level: 'strong', label: 'Strong', stars: 4 };
  }

  if (score >= 60) {
    return { level: 'possible', label: 'Possible', stars: 3 };
  }

  if (score > 0) {
    return { level: 'weak', label: 'Weak', stars: 2 };
  }

  return { level: 'none', label: 'No match', stars: 0 };
}

class MatchScore {
  constructor(parserId = '') {
    this.parserId = parserId;
    this.confidence = 0;
    this.reasons = [];
  }

  add(condition, weight, reason) {
    if (!condition) return this;
    this.confidence += Number(weight || 0);
    if (reason) this.reasons.push(String(reason));
    return this;
  }

  addServiceUuid(condition, reason) {
    return this.add(condition, MatchWeights.SERVICE_UUID, reason);
  }

  addPayload(condition, reason) {
    return this.add(condition, MatchWeights.PAYLOAD, reason);
  }

  addManufacturer(condition, reason) {
    return this.add(condition, MatchWeights.MANUFACTURER, reason);
  }

  addServiceData(condition, reason) {
    return this.add(condition, MatchWeights.SERVICE_DATA, reason);
  }

  addPayloadLength(condition, reason) {
    return this.add(condition, MatchWeights.PAYLOAD_LENGTH, reason);
  }

  addLocalName(condition, reason) {
    return this.add(condition, MatchWeights.LOCAL_NAME, reason);
  }

  addMacPrefix(condition, reason) {
    return this.add(condition, MatchWeights.MAC_PREFIX, reason);
  }

  toResult() {
    return {
      confidence: this.confidence,
      reason: this.reasons.join(', '),
      reasons: [...this.reasons],
      rating: getConfidenceRating(this.confidence),
    };
  }
}

module.exports = {
  MatchScore,
  MatchWeights,
  getConfidenceRating,
};