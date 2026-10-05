import { expect, test } from "vitest";

// Verifică doar că pipeline-ul de teste funcționează. Se șterge în Task 4.
test("sanity", () => {
  expect(1 + 1).toBe(2);
});
