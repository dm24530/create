import assert from "node:assert/strict";
import test from "node:test";

const { guessModelCapability } = await import(
    new URL("./model-capability.ts", import.meta.url).href
) as typeof import("./model-capability");

test("classifies Seedance video models used by managed canvas channels", () => {
    assert.equal(guessModelCapability("seedance-2.0"), "video");
    assert.equal(guessModelCapability("seedance-2.0-fast"), "video");
    assert.equal(guessModelCapability("seedance-2.5"), "video");
    assert.equal(guessModelCapability("dreamina-seedance-2-5"), "video");
});

test("keeps existing image, video, text, and audio classification", () => {
    assert.equal(guessModelCapability("grok-imagine-video"), "video");
    assert.equal(guessModelCapability("wan3.0-yuanlian"), "video");
    assert.equal(guessModelCapability("gpt-image-2"), "image");
    assert.equal(guessModelCapability("gpt-4o-mini-tts"), "audio");
    assert.equal(guessModelCapability("gpt-5.5"), "text");
});
