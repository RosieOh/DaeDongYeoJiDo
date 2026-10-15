import { chromium, expect } from "@playwright/test";
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error(e.message);
});
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource"))
    errors.push(m.text());
});
const position = async () =>
  Number(await page.locator(".journey-canvas").getAttribute("data-player-z"));
const waitForJourney = async () => {
  await expect(page.locator(".journey-canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".journey-loading")).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.locator(".journey-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  expect(await page.locator(".quest-stop").count()).toBeGreaterThan(0);
  await page.waitForTimeout(350);
};
try {
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".model-marker")).toHaveCount(12);
  expect(
    await page.evaluate(() => document.fonts.check("16px Pretendard")),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/daedong-model-map.png", fullPage: true });
  await page
    .getByRole("button", { name: "여행 시뮬레이션", exact: true })
    .click();
  await waitForJourney();
  await page.screenshot({ path: "/tmp/daedong-journey.png", fullPage: true });
  await page.locator(".journey-canvas").focus();

  await expect(
    page.getByRole("button", { name: "가까운 명소 발견하기" }),
  ).toBeEnabled();
  await page.keyboard.press("e");
  await expect(page.getByRole("region", { name: "발견한 명소" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("daedong:journey:geo-v1:jeonju")),
    ),
  ).toContain("origin");
  await page.getByRole("button", { name: "발견 정보 닫기" }).click();
  await page.keyboard.down("w");
  await expect
    .poll(
      async () =>
        Number(
          await page.locator(".journey-canvas").getAttribute("data-distance"),
        ),
      { timeout: 10000 },
    )
    .toBeGreaterThan(3);
  await page.keyboard.up("w");
  // 경공: a triple jump lifts the traveller and they land again.
  const groundY = Number(
    await page.locator(".journey-canvas").getAttribute("data-player-y"),
  );
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down("Space");
    await page.waitForTimeout(200);
    await page.keyboard.up("Space");
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".journey-canvas")).toHaveAttribute(
    "data-airborne",
    "true",
  );
  expect(
    Number(await page.locator(".journey-canvas").getAttribute("data-player-y")),
  ).toBeGreaterThan(groundY + 1.5);
  await expect(page.locator(".journey-canvas")).toHaveAttribute(
    "data-airborne",
    "false",
    { timeout: 8000 },
  );
  // 제운종 soars high; 천근추 drives the traveller back down.
  await page.waitForTimeout(1200);
  const beforeSoar = Number(
    await page.locator(".journey-canvas").getAttribute("data-player-y"),
  );
  await page.keyboard.press("q");
  await expect
    .poll(
      async () =>
        Number(
          await page.locator(".journey-canvas").getAttribute("data-player-y"),
        ),
      { timeout: 4000 },
    )
    .toBeGreaterThan(beforeSoar + 8);
  await page.keyboard.press("c");
  await expect(page.locator(".journey-canvas")).toHaveAttribute(
    "data-airborne",
    "false",
    { timeout: 6000 },
  );
  await expect(page.getByRole("log", { name: "강호 소식" })).toContainText(
    "제운종",
  );
  await page
    .getByRole("button", { name: "여행 일시정지", exact: true })
    .click();
  await page.waitForTimeout(150);
  const beforePause = await position();
  await page.keyboard.down("w");
  await page.waitForTimeout(450);
  await page.keyboard.up("w");
  expect(await position()).toBeCloseTo(beforePause, 1);
  await page
    .locator(".journey-pause")
    .getByRole("button", { name: "여행 계속하기" })
    .click();
  await page.getByRole("button", { name: "노을 풍경으로 전환" }).click();
  await page.getByRole("button", { name: "달밤 풍경으로 전환" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/daedong-journey-night.png" });
  await page.getByRole("button", { name: "낮 풍경으로 전환" }).click();
  await expect(
    page.getByRole("button", { name: "노을 풍경으로 전환" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "풍경 사진 저장" }).click();
  expect((await download).suggestedFilename()).toContain("전주 한옥마을");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForJourney();
  await expect(page.locator(".quest-stop.discovered")).toHaveCount(1);
  for (const id of [
    "seorak",
    "palace",
    "seongsan",
    "bulguksa",
    "suncheon",
    "boseong",
    "busan",
    "nami",
    "suwon",
    "danyang",
    "andong",
  ]) {
    await page
      .getByRole("combobox", { name: "탐험할 여행지" })
      .selectOption(id);
    await waitForJourney();
    await expect(page.locator(".journey-canvas")).toHaveAttribute(
      "data-scene",
      id,
    );
    await expect(page.locator(".quest-stop.discovered")).toHaveCount(0);
    await page.locator(".journey-canvas").focus();
    await page.keyboard.down("w");
    await expect
      .poll(
        async () =>
          Number(
            await page.locator(".journey-canvas").getAttribute("data-distance"),
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(1);
    await page.keyboard.up("w");
    if (["palace", "seongsan", "nami", "seorak"].includes(id))
      await page.screenshot({ path: `/tmp/geoworld-${id}.png` });
    console.log(`PASS: ${id} GIS scene render and keyboard movement`);
  }
  await page
    .getByRole("combobox", { name: "탐험할 여행지" })
    .selectOption("jeonju");
  await waitForJourney();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const stick = await page.locator(".touch-stick").boundingBox();
  const beforeTouch = Number(
    await page.locator(".journey-canvas").getAttribute("data-distance"),
  );
  await page.mouse.move(stick.x + 50, stick.y + 50);
  await page.mouse.down();
  await page.mouse.move(stick.x + 50, stick.y + 20);
  await page.waitForTimeout(850);
  await page.mouse.up();
  expect(
    Number(await page.locator(".journey-canvas").getAttribute("data-distance")),
  ).toBeGreaterThan(beforeTouch + 1);
  const touchY = Number(
    await page.locator(".journey-canvas").getAttribute("data-player-y"),
  );
  const jump = await page.getByRole("button", { name: "경공" }).boundingBox();
  await page.mouse.move(jump.x + jump.width / 2, jump.y + jump.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  expect(
    Number(await page.locator(".journey-canvas").getAttribute("data-player-y")),
  ).toBeGreaterThan(touchY + 0.5);
  await page.mouse.up();
  await expect(page.locator(".journey-canvas")).toHaveAttribute(
    "data-airborne",
    "false",
    { timeout: 8000 },
  );
  await page.getByRole("button", { name: "달리기 전환" }).click();
  await expect(
    page.getByRole("button", { name: "달리기 전환" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "/tmp/daedong-journey-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "지도로 돌아가기", exact: true })
    .click();
  await expect(page.locator(".map-canvas")).toBeVisible();
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 20000 });
  expect(errors).toEqual([]);
  console.log(
    "PASS: Pretendard, 12 map models, direct journey navigation, walking, discovery, persistence, pause, 경공 triple jump, 제운종 soar, 천근추 plunge and landing, day/sunset/moonlit night, screenshot download, destination change, mobile joystick, running toggle, return to map, zero runtime errors.",
  );
} finally {
  await browser.close();
}
