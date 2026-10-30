import { test, expect, type Page } from "@playwright/test";
import {createSuggested} from './journey-helpers';
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });

test("activity recovers when retention invalidates its persisted cursor", async ({page}) => {
  await page.goto("/#/vacancies");
  await page.getByRole("button", {name:"Load clarification example", exact:true}).click();
  await page.getByRole("button", {name:"Run agent", exact:true}).click();
  await expect(page.getByText("PERSISTED FEED", {exact:true})).toBeVisible();
  let invalidated = false;
  let rebuilt = false;
  await page.route("**/api/v1/events/changes?**", async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("after") && !invalidated) {
      invalidated = true;
      await route.fulfill({status:404,contentType:"application/json",body:JSON.stringify({detail:"Resource not found"})});
    } else {
      if (invalidated && query.get("tail") === "true") rebuilt = true;
      await route.continue();
    }
  });
  await expect.poll(() => rebuilt, {timeout:15000}).toBe(true);
  await expect(page.getByText("PERSISTED FEED", {exact:true})).toBeVisible();
  await page.unroute("**/api/v1/events/changes?**");
});

test("custom Support vacancy, real parsing, approved clarification, interview conflict and scheduling",async({page,browser})=>{
  await createSuggested(page,"Customer Support · custom operations","handle complaints");
  await page.getByLabel("Synthetic CV file").selectOption("support");
  await page.getByRole("button",{name:"Add synthetic file",exact:true}).click();
  await page.getByRole("button",{name:"Run agent",exact:true}).click();
  await expect(page.getByRole("heading",{name:/clarification drafts? need/})).toBeVisible({timeout:30000});
  await page.getByRole("link",{name:/Rina Kartika/}).first().click();
  await page.getByRole("tab",{name:"Clarification",exact:true}).click();
  await page.getByRole("button",{name:"Review & approve questions"}).click();
  await page.getByRole("button",{name:"Approve questions",exact:true}).click();
  const clarificationLink=page.getByRole("link",{name:"Open demo candidate portal",exact:true});
  await expect(clarificationLink).toBeVisible({timeout:20000});
  const answerContext=await browser.newContext();const answerPortal=await answerContext.newPage();
  await answerPortal.goto((await clarificationLink.getAttribute("href"))!);
  await answerPortal.getByRole("button",{name:"Continue with private invitation"}).click();
  const response="I handled a complaint about a damaged online order. I checked the order and courier records, offered a refund or replacement, arranged the replacement and confirmed that the customer received it two days later.";
  await answerPortal.locator(".portal-answers textarea").fill(response);
  await answerPortal.getByRole("button",{name:"Review before submitting"}).click();
  await answerPortal.getByRole("button",{name:"Submit factual answers",exact:true}).click();
  await expect(page.getByText("review ready",{exact:true})).toBeVisible({timeout:20000});
  await page.getByRole("tab",{name:"Evidence",exact:true}).click();await expect(page.getByText(response,{exact:true})).toBeVisible();
  await expect(page.getByText("candidate reported",{exact:true}).first()).toBeVisible();await answerContext.close();
  await page.getByRole("tab",{name:"Overview",exact:true}).click();
  await page.getByLabel("Decision",{exact:true}).selectOption("shortlist");
  await page.getByLabel("Job-related rationale").fill("Human review: an interview can clarify the complaint-handling evidence.");
  await page.getByRole("button",{name:"Review decision",exact:true}).click();
  await page.getByRole("button",{name:"Record decision",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab",{name:"Interview",exact:true}).click();
  await page.getByRole("button",{name:"Generate source-linked brief",exact:true}).click();
  await page.getByLabel("Interview brief content").fill("Approved requirements and stored findings. PRIVATE INTERVIEW NOTE: never expose this to the candidate.");
  await page.getByRole("button",{name:"Save brief draft",exact:true}).click();
  await page.getByRole("button",{name:"Review & approve brief",exact:true}).click();
  await page.getByRole("button",{name:"Approve brief",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const when=new Date(Date.now()+3*86400000);while([0,6].includes(when.getUTCDay()))when.setUTCDate(when.getUTCDate()+1);
  const day=when.toISOString().slice(0,10);const last=new Date(when.getTime()+3*86400000).toISOString().slice(0,10);
  await page.getByLabel("Earliest scheduling date").fill(day+"T09:00");
  await page.getByLabel("Latest scheduling date").fill(last+"T17:00");
  await page.getByRole("button",{name:"Save interview plan draft",exact:true}).click();
  await page.getByRole("button",{name:"Review interview invitation approval",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("synthetic-0@example.test");
  await expect(page.getByRole("dialog")).toContainText("Asia/Jakarta");
  await expect(page.getByRole("button",{name:"Approve interview invitation",exact:true})).toBeDisabled();
  await page.getByRole("checkbox",{name:/I approve this exact interview recipient/}).check();
  await page.getByLabel("Interview authorization reason").fill("Approved exact recipient, drafts, bounds, interviewers and explicit candidate selection.");
  await page.getByRole("button",{name:"Approve interview invitation",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const open=page.getByRole("link",{name:"Open demo scheduling portal",exact:true});await expect(open).toBeVisible({timeout:15000});
  const link=await open.getAttribute("href");const context=await browser.newContext();const portal=await context.newPage();await portal.goto(link!);
  await portal.getByRole("button",{name:"Continue with private invitation"}).click();
  const schedule=portal.getByRole("region",{name:"Private interview scheduling"});await expect(schedule).toBeVisible();
  await expect(portal.getByText(/PRIVATE INTERVIEW NOTE/)).toHaveCount(0);
  await portal.getByLabel("Time expression to clarify (optional)").fill("Thursday afternoon");
  await portal.getByRole("button",{name:"Offer availability / clarify time"}).click();
  await expect(schedule.getByText("confirmation required",{exact:true})).toBeVisible();
  await expect(schedule.getByText(/Recorded booking/)).toHaveCount(0);
  await portal.getByLabel("Time expression to clarify (optional)").fill("");
  await portal.getByLabel("Available from (explicit date and time)").fill(day+"T10:00");
  await portal.getByLabel("Available until (explicit date and time)").fill(day+"T15:00");
  await portal.getByRole("button",{name:"Offer availability / clarify time"}).click();
  await expect(schedule.getByRole("heading",{name:"Explicit available options"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Simulate calendar conflict · DEMO",exact:true})).toBeVisible({timeout:20000});
  await page.getByRole("button",{name:"Simulate calendar conflict · DEMO",exact:true}).click();
  await portal.getByRole("button",{name:"Select interview option",exact:true}).first().click();
  await expect(portal.getByRole("dialog")).toContainText("Asia/Jakarta");
  await portal.getByRole("button",{name:"Confirm selected interview time",exact:true}).click();
  await expect(schedule.getByText(/Selected slot is no longer available/)).toBeVisible({timeout:20000});
  await portal.getByRole("button",{name:"Select interview option",exact:true}).first().click();
  await portal.getByRole("button",{name:"Confirm selected interview time",exact:true}).click();
  await expect(schedule.getByText(/DEMO booking:/)).toBeVisible({timeout:20000});
  const before=await page.getByText(/Google event identifier:/).innerText();
  await portal.getByRole("button",{name:"Select rescheduling option",exact:true}).nth(2).click();
  await portal.getByRole("button",{name:"Confirm selected interview time",exact:true}).click();
  await expect(schedule.getByText(/DEMO booking:/)).toBeVisible({timeout:20000});
  await expect(page.getByText("confirmation · simulated",{exact:true})).toHaveCount(2,{timeout:20000});
  expect(await page.getByText(/Google event identifier:/).innerText()).toBe(before);
  await page.getByRole("button",{name:"Cancel interview coordination",exact:true}).click();
  await page.getByLabel("Cancellation reason",{exact:true}).fill("Recruiter cancelled the scheduled interview.");
  await page.getByRole("button",{name:"Confirm interview cancellation",exact:true}).click();
  await expect(page.getByText("cancelled",{exact:true}).first()).toBeVisible({timeout:20000});
  await context.close();
});

test("Customer Support clarification is delivered in demo mailbox and resumes from the actual portal", async ({page, browser}) => {
  await page.goto("/#/vacancies");
  await page.getByRole("button", {name: "Load clarification example", exact: true}).click();
  await page.getByRole("button", {name: "Run agent", exact: true}).click();
  await expect(page.getByRole("heading", {name: /clarification drafts? need/})).toBeVisible({timeout: 30000});
  await page.getByRole("link", {name: /Synthetic Support Applicant/}).first().click();
  await page.getByRole("tab", {name: "Clarification", exact: true}).click();
  await expect(page.getByText(/Describe a complaint you personally handled/)).toBeVisible();
  await page.getByRole("button", {name: "Review & approve questions"}).click();
  await expect(page.getByRole("dialog")).toContainText("reminder policy");
  await page.getByRole("button", {name: "Approve questions", exact: true}).click();
  const open = page.getByRole("link", {name: "Open demo candidate portal", exact: true});
  await expect(open).toBeVisible({timeout: 20000});
  const link = await open.getAttribute("href");
  const context = await browser.newContext();
  const portal = await context.newPage();
  await portal.goto(link!);
  await portal.getByRole("button", {name: "Continue with private invitation"}).click();
  await expect(portal.getByRole("heading", {name: "Clarification questions"})).toBeVisible();
  await expect(portal.getByLabel("Response choice 1")).toHaveValue("answer");
  const response = "I handled a complaint from an online shop customer whose parcel was damaged. I checked the order, contacted the courier, offered a replacement or refund, and confirmed that the customer received the replacement two days later.";
  await portal.locator(".portal-answers textarea").fill(response);
  await portal.getByRole("button", {name: "Save draft", exact: true}).click();
  await expect(portal.getByText(/Draft saved on server/)).toBeVisible();
  await portal.reload();
  await expect(portal.locator(".portal-answers textarea")).toHaveValue(response);
  await portal.getByRole("button", {name: "Review before submitting"}).click();
  await portal.getByRole("button", {name: "Submit factual answers", exact: true}).click();
  await expect(portal.getByRole("heading", {name: "Submitted for recruiter review"})).toBeVisible();
  const workflow = page.getByRole("region", {name: "Persisted clarification workflow"});
  await expect(workflow.getByText("review ready", {exact: true})).toBeVisible({timeout: 20000});
  await expect(workflow.getByText(/Explore handle complaints/)).toBeVisible();
  await workflow.getByText("Validated actions and finding changes").click();
  await expect(workflow.getByText("Before: unknown → After: partial")).toBeVisible();
  await page.getByRole("tab", {name: "Evidence", exact: true}).click();
  await expect(page.getByText(response, {exact: true})).toBeVisible();
  await expect(page.getByText("candidate reported", {exact: true}).first()).toBeVisible();
  await portal.getByText("Submitted answer · factual correction").click();
  await portal.getByRole("button", {name: "Correct this answer"}).click();
  await portal.getByLabel("Corrected factual answer").fill(response+" I confirmed the replacement by phone.");
  await portal.getByLabel("Reason for correction").fill("Added the confirmation method.");
  await portal.getByRole("button", {name: "Submit factual correction", exact: true}).click();
  await expect(portal.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", {name: "Clarification", exact: true}).click();
  await expect(workflow.getByText("review ready", {exact: true})).toBeVisible({timeout: 20000});
  await context.close();
});
async function createCustom(
  page: Page,
  title = "Community Platform Developer",
) {
  await page.goto("/#/vacancies");
  await page
    .getByRole("link", { name: "Create vacancy", exact: true })
    .first()
    .click();
  await page.getByLabel("Job title", { exact: true }).fill(title);
  await page
    .getByLabel("Optional starter template")
    .selectOption("Software Developer");
  await expect(page.getByLabel("Job title", { exact: true })).toHaveValue(
    title,
  );
  await page.getByRole("button", { name: "Continue to criteria" }).click();
  await page
    .getByLabel("Criterion 1 expectation")
    .fill(
      "Describe one shipped service and your own implementation contribution.",
    );
  await page.getByRole("button", { name: "Save criteria draft" }).click();
  await expect(
    page.getByRole("button", { name: "Approve criteria version 1" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I approve these job-related criteria/ })
    .check();
  await page
    .getByLabel("Approval rationale")
    .fill(
      "These expectations are observable and relevant; self-report is acceptable context.",
    );
  await page
    .getByRole("button", { name: "Approve criteria version 1" })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish vacancy", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish vacancy", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
test("real v1 recruiter and candidate workflow, drafts, brief, approval, calendar and responsive views", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createCustom(page);
  await page.getByRole("button", { name: "Load synthetic CVs" }).click();
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /clarification drafts? need/ }),
  ).toBeVisible({ timeout: 30000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Color theme").selectOption("light");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/desktop-dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  const candidate = page.getByRole("link", { name: /Rina Kartika/ }).first();
  await candidate.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Rina Kartika", exact: true }),
  ).toBeVisible();
  const appId = new URL(page.url()).hash.split("/")[2].split("?")[0];
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByText("candidate reported", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change history" }).first().click();
  await expect(page.getByText(/Revision 1/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Clarification", exact: true }).click();
  await page.getByRole("button", { name: "Revise draft questions" }).click();
  await page
    .getByLabel("Factual question", { exact: true }).first()
    .fill(
      "Describe a test case you wrote and your own contribution. No example is an acceptable answer.",
    );
  await page.getByRole("button", { name: "Save question draft" }).click();
  await page
    .getByRole("button", { name: "Review & approve questions" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Describe a test case you wrote",
  );
  await page
    .getByRole("button", { name: "Approve questions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create candidate invitation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create private invitation", exact: true })
    .click();
  const link = await page.getByLabel("Candidate invitation link").inputValue();
  expect(link).toContain("#invite=");
  await page.getByRole("button", { name: "Close dialog" }).click();
  const candidateContext = await browser.newContext();
  const portal = await candidateContext.newPage();
  portal.on("pageerror", (e) => errors.push(e.message));
  await portal.goto(link);
  await portal
    .getByRole("button", { name: "Continue with private invitation" })
    .click();
  await expect(
    portal.getByRole("heading", { name: "Clarification questions" }),
  ).toBeVisible();
  await expect(portal.getByText("Dimas Pratama")).toHaveCount(0);
  await expect(portal.getByRole("tab", { name: "Evidence" })).toHaveCount(0);
  await portal
    .getByText("Factual profile corrections", { exact: true })
    .click();
  await portal
    .getByLabel("Your name", { exact: true })
    .fill("Rina Synthetic Correction");
  await portal
    .getByRole("button", { name: "Request factual correction" })
    .click();
  await expect(
    portal.getByRole("status").filter({ hasText: "Correction request saved" }),
  ).toBeVisible();
  await portal
    .getByText("Consent and optional source permissions", { exact: true })
    .click();
  await portal.getByRole("checkbox", { name: /I permit follow-up/ }).check();
  await portal.getByRole("button", { name: "Save permission choices" }).click();
  const answer =
    'I wrote integration tests for a synthetic service. Literal <img src=x onerror="alert(1)"> stays plain text.';
  for (const field of await portal.locator(".portal-answers textarea").all()) await field.fill(answer);
  await portal.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(portal.getByText(/Draft saved on server/)).toBeVisible();
  await portal.reload();
  await expect(portal.locator(".portal-answers textarea").first()).toHaveValue(answer);
  await portal
    .getByRole("button", { name: "Review before submitting" })
    .click();
  await expect(portal.getByRole("dialog")).toContainText(answer);
  await portal.getByRole("button", { name: "Submit factual answers" }).click();
  await expect(
    portal.getByRole("heading", { name: "Submitted for recruiter review" }),
  ).toBeVisible();
  await candidateContext.close();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(page.getByText(answer, { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".source-card img")).toHaveCount(0);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page.getByText("Candidate requested a factual correction"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve factual correction" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Rina Synthetic Correction",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Compare applicants" }).click();
  await expect(
    page.getByRole("heading", { name: "Recruiter review", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Interview brief content")
    .fill(
      "Interview brief: discuss personal contribution and testing evidence. PRIVATE REVIEWER NOTE — not for candidate portal.",
    );
  await page.getByRole("button", { name: "Save brief draft" }).click();
  await page.getByRole("button", { name: "Review & approve brief" }).click();
  await page
    .getByRole("button", { name: "Approve brief", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByLabel("Job-related shortlist rationale")
    .fill("Human review of the approved expectations and available context.");
  await expect(
    page.getByRole("button", { name: "Review human shortlist approval" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review human shortlist approval" })
    .click();
  await page
    .getByRole("button", { name: "Record shortlist approval", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/#/applications/" + appId + "?tab=Interview");
  await expect(page.getByRole("heading", {name:"Interview invitation & scheduling"})).toBeVisible();
  await expect(page.getByRole("button", {name:"Save interview plan draft"})).toBeEnabled();
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", {name:"Interview calendar",exact:true})).toBeVisible();
  await page.getByRole("link", { name: "Metrics", exact: true }).click();
  await expect(
    page.getByText("Simulated interviews", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Vacancies", exact: true }).click();
  await page
    .getByRole("link", { name: "Community Platform Developer", exact: true })
    .click();
  await page.getByLabel("Color theme").selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Job opening" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/mobile-dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("sample labels, all templates and persisted cursor reconnection without fake progress", async ({
  page,
}) => {
  await page.goto("/#/vacancies");
  await page.getByRole("button", { name: "Load sample vacancies" }).click();
  await expect(
    page.getByText("SYNTHETIC SAMPLE VACANCY", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Customer Support", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Administrative Assistant", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Customer Support", exact: true })
    .click();
  await expect(page.getByText("PERSISTED FEED", { exact: true })).toBeVisible();
  await page.route("**/api/v1/events/changes?**", (route) => route.abort());
  await expect(
    page.getByText("Feed disconnected", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText("Progress may continue on the server.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/v1/events/changes?**");
  await page.getByRole("button", { name: "Reconnect now" }).click();
  await expect(page.getByText("PERSISTED FEED", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Resend adapter for separately approved clarification and interview messages.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No API keys or OAuth access tokens are accepted in this browser.",
      { exact: false },
    ),
  ).toBeVisible();
});

test("custom criterion revisions require new approval and preserve the vacancy title", async ({
  page,
}) => {
  await createCustom(page, "Accessible Office Coordinator");
  await page.getByRole("link", { name: "Edit criteria & evidence" }).click();
  await page.getByRole("button", { name: "Continue to criteria" }).click();
  await page
    .getByLabel("Criterion 1 expectation")
    .fill("Explain a project example and its concrete outcome.");
  await page.getByRole("button", { name: "Save criteria draft" }).click();
  await expect(
    page.getByRole("button", { name: "Approve criteria version 2" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I approve these job-related criteria/ })
    .check();
  await page
    .getByLabel("Approval rationale")
    .fill("Updated the observable expectation after HR review.");
  await page
    .getByRole("button", { name: "Approve criteria version 2" })
    .click();
  await page
    .getByRole("button", { name: "Publish vacancy", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Accessible Office Coordinator",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Approved criteria · version 2", { exact: false }),
  ).toBeVisible();
});

test("disconnected startup and keyboard skip navigation recover without fake success", async ({
  page,
}) => {
  await page.route("**/api/health", (route) => route.abort());
  await page.goto("/#/vacancies");
  await expect(
    page.getByRole("heading", { name: "Unable to load this view" }),
  ).toBeVisible();
  await expect(
    page.getByText("Disconnected from Saring.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/health");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Vacancies", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Vacancies", exact: true }),
  ).toBeFocused();
  expect(page.url()).toContain("#/vacancies");
});
