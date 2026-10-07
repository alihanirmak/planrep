import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve(
  __dirname,
  `../../data/.vitest-dimension-attributes-${process.pid}-${Date.now()}.db`
);

let da: typeof import("./dimension-attributes");
let sqlite: typeof import("./db")["sqlite"];

let customerDimId: number;
let regionDimId: number;
let customerMemberId: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = testDbPath;
  process.env.JWT_SECRET = "vitest-test-secret-not-for-production";
  da = await import("./dimension-attributes");
  const db = await import("./db");
  sqlite = db.sqlite;

  customerDimId = Number(
    sqlite
      .prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)")
      .run("DA_CUSTOMER", "Müşteri", "standard").lastInsertRowid
  );
  regionDimId = Number(
    sqlite
      .prepare("INSERT INTO dimensions (code, name, type) VALUES (?,?,?)")
      .run("DA_REGION", "Bölge", "standard").lastInsertRowid
  );
  customerMemberId = Number(
    sqlite
      .prepare("INSERT INTO dimension_members (dimension_id, code, name) VALUES (?,?,?)")
      .run(customerDimId, "CUST1", "Müşteri 1").lastInsertRowid
  );
  sqlite
    .prepare("INSERT INTO dimension_members (dimension_id, code, name) VALUES (?,?,?)")
    .run(regionDimId, "EMEA", "EMEA");
});

afterAll(() => {
  sqlite?.close();
  for (const ext of ["", "-shm", "-wal", "-journal"]) {
    fs.rmSync(testDbPath + ext, { force: true });
  }
});

describe("createDimensionAttribute / listDimensionAttributes / updateDimensionAttribute / deleteDimensionAttribute", () => {
  it("attribute olusturulup okunabilir", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "SEGMENT",
      name: "Segment",
      type: "text",
    });
    expect(attr.id).toBeGreaterThan(0);
    expect(da.getDimensionAttribute(attr.id)).toEqual(attr);
  });

  it("listDimensionAttributes dimensionId'ye gore filtreler", () => {
    const attrs = da.listDimensionAttributes(customerDimId);
    expect(attrs.some((a) => a.code === "SEGMENT")).toBe(true);
    expect(da.listDimensionAttributes(regionDimId).some((a) => a.code === "SEGMENT")).toBe(false);
  });

  it("updateDimensionAttribute sadece name/orderIdx degistirir", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "TMP1",
      name: "Gecici",
      type: "number",
    });
    const updated = da.updateDimensionAttribute(attr.id, { name: "Güncellenmiş", orderIdx: 5 });
    expect(updated?.name).toBe("Güncellenmiş");
    expect(updated?.orderIdx).toBe(5);
    expect(updated?.type).toBe("number"); // degismedi
  });

  it("deleteDimensionAttribute siler ve degerlerini de temizler", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "TMP2",
      name: "Silinecek",
      type: "text",
    });
    da.setMemberAttributeValue(customerMemberId, attr.id, "deger");
    da.deleteDimensionAttribute(attr.id);
    expect(da.getDimensionAttribute(attr.id)).toBeNull();
    expect(da.getAttributeValuesForMembers([customerMemberId]).get(customerMemberId)?.["TMP2"]).toBeUndefined();
  });

  it("member_ref tipinde refDimensionId saklanir, digerlerinde null'a zorlanir", () => {
    const refAttr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "REGION",
      name: "Bölge",
      type: "member_ref",
      refDimensionId: regionDimId,
    });
    expect(refAttr.refDimensionId).toBe(regionDimId);

    const textAttr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "NOTE",
      name: "Not",
      type: "text",
      refDimensionId: regionDimId, // kasitli olarak gonderildi, text tipinde yok sayilmali
    });
    expect(textAttr.refDimensionId).toBeNull();
  });
});

describe("listDimensionAttributesWithMeta / getRefMemberOptions", () => {
  it("member_ref attribute'u referans boyutun kod/adiyla zenginlestirir", () => {
    const attrs = da.listDimensionAttributesWithMeta(customerDimId);
    const regionAttr = attrs.find((a) => a.code === "REGION");
    expect(regionAttr?.refDimensionCode).toBe("DA_REGION");
    expect(regionAttr?.refDimensionName).toBe("Bölge");
  });

  it("getRefMemberOptions referans boyutun uyelerini doner", () => {
    const attrs = da.listDimensionAttributes(customerDimId);
    const options = da.getRefMemberOptions(attrs);
    expect(options[regionDimId]).toEqual([{ code: "EMEA", name: "EMEA" }]);
  });
});

describe("setMemberAttributeValue / getAttributeValuesForMembers", () => {
  it("deger yazilip N+1 onleyen toplu okuma ile geri okunabilir", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "BULK_TEST",
      name: "Bulk Test",
      type: "text",
    });
    da.setMemberAttributeValue(customerMemberId, attr.id, "merhaba");
    const map = da.getAttributeValuesForMembers([customerMemberId]);
    expect(map.get(customerMemberId)?.["BULK_TEST"]).toBe("merhaba");
  });

  it("value=null satiri siler", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "DELETABLE",
      name: "Silinebilir",
      type: "text",
    });
    da.setMemberAttributeValue(customerMemberId, attr.id, "deger");
    da.setMemberAttributeValue(customerMemberId, attr.id, null);
    const map = da.getAttributeValuesForMembers([customerMemberId]);
    expect(map.get(customerMemberId)?.["DELETABLE"]).toBeUndefined();
  });

  it("bos id listesi icin bos Map doner", () => {
    expect(da.getAttributeValuesForMembers([]).size).toBe(0);
  });
});

describe("validateAttributeValue", () => {
  it("text her degeri gecerli kabul eder", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "VTEXT",
      name: "V Text",
      type: "text",
    });
    expect(da.validateAttributeValue(attr, "herhangi bir şey")).toBeNull();
  });

  it("number sadece sayisal string kabul eder", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "VNUM",
      name: "V Num",
      type: "number",
    });
    expect(da.validateAttributeValue(attr, "123.45")).toBeNull();
    expect(da.validateAttributeValue(attr, "abc")).toBe("invalid_number");
    expect(da.validateAttributeValue(attr, "")).toBe("invalid_number");
  });

  it("date sadece YYYY-MM-DD kabul eder", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "VDATE",
      name: "V Date",
      type: "date",
    });
    expect(da.validateAttributeValue(attr, "2026-07-10")).toBeNull();
    expect(da.validateAttributeValue(attr, "10/07/2026")).toBe("invalid_date");
  });

  it("member_ref sadece referans boyutta var olan kodu kabul eder", () => {
    const attr = da.createDimensionAttribute({
      dimensionId: customerDimId,
      code: "VREF",
      name: "V Ref",
      type: "member_ref",
      refDimensionId: regionDimId,
    });
    expect(da.validateAttributeValue(attr, "EMEA")).toBeNull();
    expect(da.validateAttributeValue(attr, "NOPE")).toBe("ref_member_not_found");
  });
});
