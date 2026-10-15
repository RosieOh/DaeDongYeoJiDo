import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:5173", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".destination-marker")).toHaveCount(12);
  expect(
    (await page.locator(".map-canvas").boundingBox()).height,
  ).toBeGreaterThan(800);
  await page.screenshot({ path: "/tmp/daedong-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "설악산 상세정보 보기", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "설악산 상세정보", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.locator(".map-bottom")).toContainText("ZOOM 11.2");
  await page.screenshot({ path: "/tmp/daedong-detail.png", fullPage: true });
  await page
    .getByRole("button", { name: "선택한 여행지 저장", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "나의 여행지도에 담았어요",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /나의 여행지도/ }).click();
  await expect(page.locator(".place-card")).toHaveCount(1);
  await expect(page.locator(".place-card")).toContainText("설악산");
  await page.getByRole("button", { name: "지도 탐험", exact: true }).click();
  await page.getByRole("button", { name: "제주", exact: true }).click();
  await expect(page.locator(".place-card")).toHaveCount(1);
  await expect(page.locator(".destination-marker")).toHaveCount(1);
  await page
    .getByRole("button", { name: "대동여지도 홈", exact: true })
    .click();
  await page.getByRole("textbox", { name: "여행지 검색" }).fill("세계유산");
  await expect(page.locator(".place-card")).toHaveCount(3);
  await page.getByRole("textbox", { name: "여행지 검색" }).fill("없는여행지");
  await expect(page.locator(".empty-state")).toContainText(
    "일치하는 여행지가 없어요",
  );
  await page.getByRole("button", { name: "모든 여행지 둘러보기" }).click();
  await page.getByRole("button", { name: "입체 지도 전환" }).click();
  await expect(
    page.getByRole("button", { name: "입체 지도 전환" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "사진 및 지도 출처" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "느긋하게 둘러보기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "둘러보기 멈추기", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".detail-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "둘러보기 멈추기", exact: true })
    .click();
  await page.getByRole("button", { name: "상세정보 닫기" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "/tmp/daedong-mobile.png", fullPage: true });
  await page.locator(".mobile-switch button").nth(1).click();
  await expect(page.locator(".explore-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "성산일출봉 상세정보 보기", exact: true })
    .click();
  await expect(page.locator(".detail-panel")).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: "/tmp/daedong-mobile-detail.png",
    fullPage: true,
  });
  const markerBox = await page
    .locator(".destination-marker.selected")
    .boundingBox();
  const detailBox = await page.locator(".detail-panel").boundingBox();
  expect(markerBox.y).toBeGreaterThan(100);
  expect(markerBox.y + markerBox.height).toBeLessThan(detailBox.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "PASS: desktop GIS render, camera zoom, place details, saved persistence, regional filtering, search, empty state, 2D switch, credits, tour, mobile details, no horizontal overflow, no runtime errors.",
  );
} finally {
  await browser.close();
}
