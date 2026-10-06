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
});

describe("isEditableTarget", () => {
  it("DOM ortami yoksa (orn. test/node ortaminda) guvenli sekilde false doner", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});
