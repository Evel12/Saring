import {expect,type Page} from '@playwright/test';
export async function createSuggested(page:Page,title:string,criterion:string) {
  await page.goto('/#/vacancies');
  await page.getByRole('link',{name:'Create vacancy',exact:true}).first().click();
  await page.getByLabel('Job title',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Continue to criteria'}).click();
  await page.getByRole('button',{name:'Suggest criteria · DEMO',exact:true}).click();
  await expect(page.getByLabel('Criterion 1 description')).not.toHaveValue('');
  await page.getByRole('button',{name:'Remove',exact:true}).last().click();
  await page.getByRole('button',{name:'Remove',exact:true}).last().click();
  await page.getByLabel('Criterion 1 description').fill(criterion);
  await page.getByLabel('Criterion 1 expectation').fill('Describe a personally handled example, actions and outcome; an alternative is acceptable.');
  await page.getByRole('button',{name:'Save criteria draft'}).click();
  await page.getByRole('checkbox',{name:/I approve these job-related criteria/}).check();
  await page.getByLabel('Approval rationale').fill('Edited for this custom role; observable job-related expectations and alternatives are approved.');
  await page.getByRole('button',{name:'Approve criteria version 1',exact:true}).click();
  await page.getByRole('button',{name:'Publish vacancy',exact:true}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
}
