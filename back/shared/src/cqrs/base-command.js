export default class BaseCommand {
  constructor(type, payload = {}) {
    this.type = type;
    this.payload = payload;
    this.createdAt = new Date().toISOString();
  }
}