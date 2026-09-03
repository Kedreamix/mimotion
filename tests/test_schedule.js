const assert = require("assert");
const S = require("../docs/schedule.js");

const SAMPLE = `trigger by: workflow_run
current system time:
UTC: 26-09-02 18:03:05
北京时间: 26-09-03 02:03:05
current cron:
UTC时间: '41 1,4,7,10,14 * * *'
北京时间: '41 9,12,15,18,22 * * *'
next cron:
UTC时间: '55 1,4,7,10,12,14 * * *'
北京时间: '55 9,12,15,18,20,22 * * *'
next exec time: UTC(1:55) 北京时间(9:55)
---STEP_STATE---
{"a":{"last_step":1357,"last_step_date":"2026-09-03"}}
`;

const parsed = S.parseCronFile(SAMPLE);
assert.deepStrictEqual(parsed.plannedHours, [9, 12, 15, 18, 20, 22]);
assert.strictEqual(parsed.liveMinute, 55);
assert.strictEqual(parsed.lastStep, 1357);

assert.deepStrictEqual(
  S.nextSlot(parsed.liveHours, parsed.liveMinute, { h: 2, min: 15 }),
  { hour: 9, minute: 55 },
);
assert.deepStrictEqual(
  S.nextSlot(parsed.liveHours, parsed.liveMinute, { h: 10, min: 0 }),
  { hour: 12, minute: 55 },
  "过了文件里冻结的 9:55 之后，应按仍生效的 next cron 找下一档，而不是显示明天 9:55",
);
assert.deepStrictEqual(
  S.nextSlot(parsed.liveHours, parsed.liveMinute, { h: 9, min: 54 }),
  { hour: 9, minute: 55 },
);
assert.deepStrictEqual(
  S.nextSlot(parsed.liveHours, parsed.liveMinute, { h: 22, min: 56 }),
  { hour: 9, minute: 55 },
);

assert.deepStrictEqual(S.unionHours([9, 12], [12, 20]), [9, 12, 20]);
console.log("ok");
