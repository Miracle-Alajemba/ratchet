import test from "node:test";
import assert from "node:assert";
import { createNdjsonParser } from "../src/engine/runner.js";

test("NDJSON parser parses complete lines", () => {
    const parser = createNdjsonParser();
    const events = parser.feed('{"type":"testrun_start","v":1}\n{"type":"testrun_done","overall_status":"passed"}\n');
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, "testrun_start");
    assert.strictEqual(events[1].type, "testrun_done");
    assert.strictEqual(events[1].overall_status, "passed");
});

test("NDJSON parser handles lines split across multiple chunks", () => {
    const parser = createNdjsonParser();
    const part1 = '{"type":"testrun_member_';
    const part2 = 'start","member_id":"mem-1"}\n{"type":"testrun_';
    const part3 = 'member_end","member_id":"mem-1","status":"passed"}\n';

    const events1 = parser.feed(part1);
    assert.strictEqual(events1.length, 0, "No complete events in chunk 1");

    const events2 = parser.feed(part2);
    assert.strictEqual(events2.length, 1, "First event completed in chunk 2");
    assert.strictEqual(events2[0].type, "testrun_member_start");
    assert.strictEqual(events2[0].member_id, "mem-1");

    const events3 = parser.feed(part3);
    assert.strictEqual(events3.length, 1, "Second event completed in chunk 3");
    assert.strictEqual(events3[0].type, "testrun_member_end");
    assert.strictEqual(events3[0].status, "passed");
});

test("NDJSON parser safely ignores unknown non-JSON lines and malformed JSON", () => {
    const parser = createNdjsonParser();
    const mixed = [
        "Debugger listening on ws://127.0.0.1:9222/devtools/browser/abc",
        '{"type":"testrun_start","v":1}',
        "[info] Chrome session attached",
        "{malformed json line that is broken",
        '{"type":"testrun_done","overall_status":"passed"}',
        "Process exiting with code 0",
    ].join("\n") + "\n";

    const events = parser.feed(mixed);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, "testrun_start");
    assert.strictEqual(events[1].type, "testrun_done");
});

test("NDJSON parser flush handles trailing line without terminal newline", () => {
    const parser = createNdjsonParser();
    const chunkWithoutNewline = '{"type":"testrun_start","v":1}\n{"type":"testrun_done","overall_status":"passed"}';
    const initialEvents = parser.feed(chunkWithoutNewline);
    assert.strictEqual(initialEvents.length, 1);

    const flushedEvents = parser.flush();
    assert.strictEqual(flushedEvents.length, 1);
    assert.strictEqual(flushedEvents[0].type, "testrun_done");
});
