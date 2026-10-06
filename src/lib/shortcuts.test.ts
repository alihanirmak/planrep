import { describe, expect, it } from "vitest";
import { matchesHotkey, isEditableTarget } from "./shortcuts";

describe("matchesHotkey", () => {
  it("mod gerektirmeyen bir kisayol icin Ctrl/Cmd basiliyken eslesmez", () => {
    expect(matchesHotkey({ key: "?", ctrlKey: false, metaKey: false }, { key: "?" })).toBe(true);
    expect(matchesHotkey({ key: "?", ctrlKey: true, metaKey: false }, { key: "?" })).toBe(false);
  });

  it("mod gerektiren bir kisayol Ctrl VEYA Cmd ile eslesir", () => {
    const spec = { key: "k", mod: true };
    expect(matchesHotkey({ key: "k", ctrlKey: true, metaKey: false }, spec)).toBe(true);
    expect(matchesHotkey({ key: "k", ctrlKey: false, metaKey: true }, spec)).toBe(true);
    expect(matchesHotkey({ key: "k", ctrlKey: false, metaKey: false }, spec)).toBe(false);
  });

  it("tus adi kucuk/buyuk harf duyarsiz karsilastirilir", () => {
    expect(matchesHotkey({ key: "K", ctrlKey: true, metaKey: false }, { key: "k", mod: true })).toBe(
      true
    );
  });

  it("farkli tus adlari eslesmez", () => {
    expect(matchesHotkey({ key: "j", ctrlKey: true, metaKey: false }, { key: "k", mod: true })).toBe(
      false
    );
  });

  it("ozel tus adlarini (Enter) oldugu gibi karsilastirir", () => {
    expect(matchesHotkey({ key: "Enter", ctrlKey: true, metaKey: false }, { key: "Enter", mod: true })).toBe(
      true
    );
  });

  it("shift gerektiren bir kisayol (orn. redo) sadece shift basiliyken eslesir", () => {
    const redo = { key: "z", mod: true, shift: true };
    expect(
      matchesHotkey({ key: "Z", ctrlKey: true, metaKey: false, shiftKey: true }, redo)
    ).toBe(true);
    expect(
      matchesHotkey({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false }, redo)
    ).toBe(false);
  });

  it("undo (shift yok) ile redo (shift var) ayni tus olsa da birbirine karismaz", () => {
    const undo = { key: "z", mod: true };
    const redo = { key: "z", mod: true, shift: true };
    const undoEvent = { key: "z", ctrlKey: true, metaKey: false, shiftKey: false };
    const redoEvent = { key: "Z", ctrlKey: true, metaKey: false, shiftKey: true };
    expect(matchesHotkey(undoEvent, undo)).toBe(true);
    expect(matchesHotkey(undoEvent, redo)).toBe(false);
    expect(matchesHotkey(redoEvent, undo)).toBe(false);
    expect(matchesHotkey(redoEvent, redo)).toBe(true);
  });
});

describe("isEditableTarget", () => {
  it("DOM ortami yoksa (orn. test/node ortaminda) guvenli sekilde false doner", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});
