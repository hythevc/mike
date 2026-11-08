import { test, expect } from "./support/fixtures";

// The AGPL section 13 source offer inside the add-in: the Settings page links
// to the exact running commit of the public source repository. build:e2e bakes
// REACT_APP_GIT_SHA=e2ecommit0001, so the /tree/<sha> suffix is deterministic
// here; the repository origin is the brand's sourceRepositoryUrl.
test("Settings links to the add-in source at the running commit", async ({
  addin,
  page,
}) => {
  await addin.gotoTaskpane({ token: "source-link-token" });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  const link = page.getByRole("link", { name: "Source code" });
  await expect(link).toHaveAttribute(
    "href",
    "https://github.com/hythevc/mike/tree/e2ecommit0001",
  );
});
