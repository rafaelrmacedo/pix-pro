const { createLogger } = require("../src/logger").default;
const { withRetry } = require("../src/retry");
const { correlationIdMiddleware } = require("../src/middleware").default;

describe("Shared Library", () => {
  describe("Logger", () => {
    let spy;
    beforeEach(() => {
      spy = jest.spyOn(console, "log").mockImplementation(() => { });
    });
    afterEach(() => {
      spy.mockRestore();
    });

    test("should log info messages", () => {
      const logger = createLogger("test-service");
      logger.info("Test info");
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("INFO"), expect.anything());
    });

    test("should include correlationId in logs", () => {
      const logger = createLogger("test-service");
      logger.info("Test info", { correlationId: "cid-123" });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("[CID:cid-123]"), expect.anything());
    });
  });

  describe("Retry", () => {
    test("should retry until success", async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        if (attempts < 3) throw new Error("Fail");
        return "Success";
      }, { maxRetries: 5, initialDelay: 10 });

      expect(attempts).toBe(3);
      expect(result).toBe("Success");
    });

    test("should throw after max retries", async () => {
      await expect(withRetry(async () => {
        throw new Error("Persistent Fail");
      }, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow("Persistent Fail");
    });
  });

  describe("Correlation ID Middleware", () => {
    test("should generate a new correlation ID if missing", () => {
      const req = { headers: {} };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      correlationIdMiddleware(req, res, next);

      expect(req.correlationId).toBeDefined();
      expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", req.correlationId);
      expect(next).toHaveBeenCalled();
    });

    test("should reuse existing correlation ID from headers", () => {
      const existingCid = "existing-cid-456";
      const req = { headers: { "x-correlation-id": existingCid } };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      correlationIdMiddleware(req, res, next);

      expect(req.correlationId).toBe(existingCid);
      expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", existingCid);
    });
  });
});
