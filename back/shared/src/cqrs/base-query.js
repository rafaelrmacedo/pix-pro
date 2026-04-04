class BaseQuery {
  constructor(type, filters = {}) {
    this.type = type;
    this.filters = filters;
    this.createdAt = new Date().toISOString();
  }
}

module.exports = { BaseQuery };

