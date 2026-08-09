import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toEchoMap, validateLiveContract } from "@particle-academy/fancy-query";
import { flowKeys, flowLive } from "../src/live";

describe("flow Live Contract", () => {
    it("is well-formed", () => {
        expect(validateLiveContract(flowLive)).toEqual([]);
    });

    it("covers a run's durable state and NOT per-node chatter", () => {
        // The defining constraint of the run/job stream shape. NodeStatusChanged
        // and NodeOutput fire per node, many times a second on a wide graph — a
        // log line is a stream, not a cache entry. In the contract, a 40-node run
        // would invalidate the run list forty times while it executes, each one a
        // re-fetch telling the UI nothing the stream had not already delivered.
        const names = flowLive.events.map((e) => e.event).join(" ");

        expect(names).not.toContain("node");
        expect(names).not.toContain("output");
        expect(names).not.toContain("log");
    });

    it("gives a run parking on a human its own event", () => {
        // The moment a form has to appear in front of somebody. Folding it into
        // `updated` would make a host filter every update to find it.
        expect(flowLive.events.map((e) => e.event)).toContain("flow.run.awaiting");
    });

    it("explains every non-standard verb it uses", () => {
        for (const entry of flowLive.events) {
            const verb = entry.event.split(".")[2]!;
            const standard = ["created", "updated", "deleted", "moved", "completed"].includes(verb);
            if (!standard) {
                expect(entry.note, `${entry.event} uses "${verb}" with no note explaining why`).toBeTruthy();
            }
        }
    });

    it("builds per-run keys the contract still reaches by prefix", () => {
        expect(flowKeys.run("r1")).toEqual(["flow", "runs", "r1"]);
        // ["flow","runs"] is a prefix of ["flow","runs","r1"], so the contract's
        // broader invalidation still hits a per-run query.
        expect(toEchoMap(flowLive)["flow.run.updated"]).toEqual([["flow", "runs"]]);
    });
});

describe("parity with FancyFlow\Laravel\LiveContract", () => {
    const phpPath = process.env.FLOW_PHP_SRC
        ? join(process.env.FLOW_PHP_SRC, "LiveContract.php")
        : join(__dirname, "..", "..", "fancy-flow-php", "src", "Laravel", "LiveContract.php");

    function phpEvents(): Record<string, string[][]> | null {
        let source: string;
        try {
            source = readFileSync(phpPath, "utf8");
        } catch {
            return null;
        }

        const block = /const EVENTS = \[([\s\S]*?)\n    \];/.exec(source)?.[1] ?? "";
        const events: Record<string, string[][]> = {};

        // Line by line: a multiline regex requiring a trailing newline per entry
        // silently drops the LAST one, which is how the catalog parity test first
        // parsed 5 of 6 and still reported success.
        for (const line of block.split("\n")) {
            const m = /^\s*'([a-z0-9.\-_]+)'\s*=>\s*(\[.*\])\s*,?\s*$/.exec(line);
            if (!m) continue;
            const keys: string[][] = [];
            for (const [, inner] of m[2]!.matchAll(/\[([^[\]]*)\]/g)) {
                keys.push([...inner.matchAll(/'([^']+)'/g)].map((k) => k[1]!));
            }
            events[m[1]!] = keys;
        }

        return events;
    }

    /**
     * A missing PHP twin must not read as parity.
     *
     * These assertions used to `return` early when the file was not found, and
     * the sibling path only resolves inside the .agi envelope — so in CI, where
     * the PHP repo is not checked out, every case returned immediately and the
     * suite went green having compared nothing. That is the whole failure this
     * file exists to prevent, reproduced in the file itself.
     *
     * Locally a skip is still right; in CI it is a hole.
     */
    function requirePhp() {
        const php = phpEvents();
        if (php === null && process.env.CI) {
            throw new Error(
                "The PHP LiveContract was not found, so parity was not checked. " +
                    "Set FLOW_PHP_SRC to the PHP package's source directory, " +
                    "or check the repo out in CI.",
            );
        }
        return php;
    }

    it("declares the SAME event names on both sides", () => {
        const php = requirePhp();
        if (php === null) return;

        expect(Object.keys(php).sort()).toEqual(flowLive.events.map((e) => e.event).sort());
    });

    it("invalidates the SAME keys for every event", () => {
        const php = requirePhp();
        if (php === null) return;

        for (const { event, keys } of flowLive.events) {
            expect(php[event], `PHP does not declare ${event}`).toEqual(keys.map((k) => [...k]));
        }
    });

    it("parsed the PHP completely, not partially", () => {
        const php = requirePhp();
        if (php === null) return;

        expect(Object.keys(php)).toHaveLength(flowLive.events.length);
    });
});
