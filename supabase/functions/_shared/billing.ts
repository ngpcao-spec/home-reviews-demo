export interface BillingProvider{manageUrl(organizationId:string):Promise<string|null>}
export class MockBillingProvider implements BillingProvider{async manageUrl(){return null}}
export function createBillingProvider():BillingProvider{return new MockBillingProvider()}
