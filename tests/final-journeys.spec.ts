import {test,expect} from '@playwright/test';
import {createSuggested} from './journey-helpers';
test.setTimeout(120000);
test.use({actionTimeout:15000});

test('custom Developer: private portfolio stays unknown, optional alternative and no negative inference',async({page,browser})=>{
  await createSuggested(page,'Software Developer · custom integrations','Provide a code sample or alternative walkthrough');
  await page.getByLabel('Synthetic CV file').selectOption('developer');
  await page.getByRole('button',{name:'Add synthetic file',exact:true}).click();
  await page.getByRole('button',{name:'Run agent',exact:true}).click();
  await expect(page.getByRole('heading',{name:/clarification drafts? need/})).toBeVisible({timeout:30000});
  await page.getByRole('link',{name:/Dimas Pratama/}).first().click();
  await page.getByRole('tab',{name:'Evidence',exact:true}).click();
  await expect(page.getByText('unknown',{exact:true})).toBeVisible();
  await expect(page.getByText('conflicting',{exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:'Clarification',exact:true}).click();
  await page.getByRole('button',{name:'Revise draft questions'}).click();
  await page.getByLabel('Factual question',{exact:true}).fill('The optional portfolio is unavailable. Could you share a code sample or describe a Go service you personally implemented? You may decline or offer an alternative.');
  await page.getByRole('button',{name:'Save question draft'}).click();
  await page.getByRole('button',{name:'Review & approve questions'}).click();await page.getByRole('button',{name:'Approve questions',exact:true}).click();
  const link=page.getByRole('link',{name:'Open demo candidate portal',exact:true});await expect(link).toBeVisible({timeout:20000});
  const context=await browser.newContext();const portal=await context.newPage();await portal.goto((await link.getAttribute('href'))!);
  await portal.getByRole('button',{name:'Continue with private invitation'}).click();await expect(portal.getByText(/optional portfolio is unavailable/)).toBeVisible();
  await portal.getByLabel('Response choice 1').selectOption('alternative');
  await portal.locator('.portal-answers textarea').fill('As an alternative to a public code sample, I implemented a Go order service with PostgreSQL migrations, wrote integration tests and deployed Docker containers. I can walk through request handling and retries in the interview; employer source code is private.');
  await portal.getByRole('button',{name:'Review before submitting'}).click();await portal.getByRole('button',{name:'Submit factual answers',exact:true}).click();
  await expect(page.getByText('review ready',{exact:true})).toBeVisible({timeout:20000});await page.getByRole('tab',{name:'Overview',exact:true}).click();await expect(page.getByText('undecided',{exact:true})).toBeVisible();
  await context.close();
});

test('real OCR and unreadable-source replacement through the UI',async({page})=>{
  await createSuggested(page,'Customer Support · document recovery','handle complaints');
  const vacancyUrl=page.url();
  await page.getByLabel('Synthetic CV file').selectOption('scan');await page.getByRole('button',{name:'Add synthetic file',exact:true}).click();await page.getByRole('button',{name:'Run agent',exact:true}).click();
  await expect(page.getByRole('heading',{name:/clarification drafts? need/})).toBeVisible({timeout:30000});
  await page.getByRole('link',{name:/Ayu Lestari/}).first().click();await page.getByText(/Extraction revision 1/).click();await expect(page.getByText(/tesseract-ocr/)).toBeVisible();
  await page.goto(vacancyUrl);await page.getByLabel('Synthetic CV file').selectOption('unreadable');await page.getByRole('button',{name:'Add synthetic file',exact:true}).click();await page.getByRole('button',{name:'Run agent',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry failed workflow',exact:true})).toBeVisible({timeout:30000});
  await page.getByRole('link',{name:/Bagas Nugroho/}).first().click();await page.getByRole('button',{name:'Exclude unreadable source',exact:true}).click();await page.getByLabel('Source exclusion reason').fill('Malformed synthetic original; replace with readable source.');await page.getByRole('button',{name:'Confirm source exclusion',exact:true}).click();
  await page.getByRole('button',{name:'Add synthetic replacement',exact:true}).click();await page.getByRole('button',{name:'Reanalyze sources',exact:true}).click();
  await expect(page.getByText(/Extraction revision 1/)).toBeVisible({timeout:30000});await expect(page.getByText(/Excluded from processing/)).toBeVisible();
});

test('five synthetic people have separate applications in two isolated exploration vacancies',async({page,browser})=>{
  const externalFonts:string[]=[];page.on('request',r=>{if(/fonts\.googleapis|fonts\.gstatic/.test(r.url()))externalFonts.push(r.url());});
  await page.goto('/#/vacancies');await expect(page.getByRole('link',{name:'Create vacancy',exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Explore complete demo',exact:true}).click();await expect(page.getByRole('heading',{name:'Customer Support · sample',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/Rina Kartika/})).toBeVisible();await page.getByRole('button',{name:'Run agent',exact:true}).click();await expect(page.getByRole('heading',{name:/clarification drafts? need/})).toBeVisible({timeout:30000});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(async()=>{await document.fonts.ready;(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);});await page.screenshot({path:'test-results/final-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'test-results/final-mobile.png',fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(externalFonts).toEqual([]);
  await page.getByRole('link',{name:'Vacancies',exact:true}).click();await page.getByRole('link',{name:'Software Developer · sample',exact:true}).click();
  await expect(page.getByRole('link',{name:/Rina Kartika/})).toBeVisible();await page.getByRole('button',{name:'Run agent',exact:true}).click();await expect(page.getByRole('heading',{name:/clarification drafts? need/})).toBeVisible({timeout:30000});
  await page.getByRole('link',{name:/Bagas Nugroho/}).first().click();await page.getByRole('tab',{name:'Evidence',exact:true}).click();await expect(page.getByText(/ignore previous instructions/)).toHaveCount(0);await expect(page.getByText('conflicting',{exact:true})).toHaveCount(0);
  const privatePath=new URL(page.url()).hash;const second=await browser.newContext();const other=await second.newPage();await other.goto('/'+privatePath);await expect(other.getByText(/Resource not found/)).toBeVisible();await second.close();
});
