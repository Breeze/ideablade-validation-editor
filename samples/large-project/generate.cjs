// Generates a large test project for the editor: 10 JSON metadata files with 15-20 model types each, 3 TypeScript
// files with 1-3 maps each, and large.ivproj listing them. For trying the editor with a lot of metadata (the sidebar's
// scrolling, the search, folding). The output is always the same: `node generate.cjs` writes it again.
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
let seed = 42;
/** A small seeded random number generator, so every run writes the same files. */
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

const areas = {
  sales: ['Customer', 'CustomerAddress', 'CustomerContact', 'Quote', 'QuoteLine', 'SalesOrder', 'SalesOrderLine', 'Discount', 'PriceList', 'PriceListItem', 'SalesRegion', 'SalesTarget', 'Commission', 'Lead', 'Opportunity', 'Campaign', 'CampaignResponse', 'Territory', 'SalesRep', 'Contract'],
  billing: ['Invoice', 'InvoiceLine', 'CreditNote', 'CreditNoteLine', 'Payment', 'PaymentMethod', 'PaymentTerm', 'TaxRate', 'TaxExemption', 'Currency', 'ExchangeRate', 'BillingAccount', 'Statement', 'StatementLine', 'Refund', 'Dunning', 'LateFee', 'WriteOff'],
  inventory: ['Product', 'ProductCategory', 'ProductVariant', 'StockItem', 'StockMovement', 'Warehouse', 'WarehouseZone', 'Bin', 'Supplier', 'SupplierProduct', 'PurchaseOrder', 'PurchaseOrderLine', 'GoodsReceipt', 'GoodsReceiptLine', 'StockCount', 'Reorder', 'Batch', 'SerialNumber', 'UnitOfMeasure'],
  shipping: ['Shipment', 'ShipmentLine', 'Carrier', 'CarrierService', 'Package', 'PackageItem', 'Route', 'RouteStop', 'DeliveryWindow', 'ShippingRate', 'ShippingZone', 'TrackingEvent', 'ReturnRequest', 'ReturnLine', 'CustomsDeclaration', 'Pallet'],
  hr: ['Employee', 'EmployeeAddress', 'EmergencyContact', 'Department', 'Position', 'JobGrade', 'Salary', 'Bonus', 'LeaveRequest', 'LeaveBalance', 'Timesheet', 'TimesheetLine', 'Training', 'Certification', 'PerformanceReview', 'Goal', 'Benefit', 'BenefitEnrollment', 'Termination'],
  staffing: ['StaffingResource', 'Address', 'PhoneNumber', 'Rate', 'RateType', 'Skill', 'SkillLevel', 'WorkExperienceItem', 'Placement', 'PlacementRate', 'Assignment', 'AssignmentShift', 'Requisition', 'Interview', 'Reference', 'BackgroundCheck', 'Availability'],
  projects: ['Project', 'ProjectPhase', 'Milestone', 'Task', 'TaskDependency', 'TaskAssignment', 'TimeEntry', 'Expense', 'ExpenseReport', 'Budget', 'BudgetLine', 'Risk', 'Issue', 'ChangeRequest', 'Deliverable', 'Stakeholder', 'StatusReport'],
  support: ['Ticket', 'TicketComment', 'TicketAttachment', 'Agent', 'Team', 'Queue', 'ServiceLevel', 'Escalation', 'KnowledgeArticle', 'ArticleCategory', 'Survey', 'SurveyAnswer', 'Macro', 'Tag', 'Holiday', 'BusinessHours'],
  assets: ['Asset', 'AssetType', 'AssetLocation', 'Maintenance', 'MaintenanceSchedule', 'WorkOrder', 'WorkOrderTask', 'SparePart', 'Meter', 'MeterReading', 'Inspection', 'InspectionItem', 'Warranty', 'Lease', 'Depreciation', 'Disposal'],
  identity: ['User', 'UserProfile', 'Role', 'Permission', 'RolePermission', 'Group', 'GroupMember', 'Session', 'ApiKey', 'AuditEntry', 'Tenant', 'TenantSetting', 'Invitation', 'PasswordPolicy', 'LoginAttempt', 'Consent'],
};

const props = [
  ['name', 'string'], ['code', 'string'], ['description', 'string'], ['email', 'string'], ['phone', 'string'], ['amount', 'number'],
  ['quantity', 'number'], ['percentage', 'number'], ['startDate', 'date'], ['endDate', 'date'], ['zipcode', 'string'], ['url', 'string'],
  ['notes', 'string'], ['reference', 'string'], ['status', 'string'], ['priority', 'number'],
];

function property([name, type]) {
  const p = {};
  if (random() < 0.5) p.required = true;
  // The library's built-in validators only (its docs/validators.md), so the project has no errors.
  const validators = [];
  if (type === 'string') {
    if (name === 'email') validators.push({ name: 'email' });
    else if (name === 'phone') validators.push({ name: 'phone' });
    else if (name === 'zipcode') validators.push({ name: 'zipCode' });
    else if (name === 'url') validators.push({ name: 'pattern', id: 'URL_FORMAT', context: { expression: '^https?://\\S+$', flags: 'i', messageTemplate: "'%displayName%' must be a web address" } });
    else if (name === 'code') validators.push({ name: 'pattern', id: 'CODE_FORMAT', context: { expression: '^[A-Z]{2,4}-\\d{3,6}$', messageTemplate: "'%displayName%' must look like AB-123" } });
    else p.maxLength = pick([30, 50, 100, 250, 2000]);
  } else if (type === 'number') {
    validators.push({ name: 'numeric', context: { allowDecimals: true } });
    if (name === 'percentage') validators.push({ name: 'range', context: { minValue: 0, maxValue: 100 } });
    else if (random() < 0.6) validators.push({ name: 'range', context: { minValue: 0 } });
  } else if (type === 'date') {
    validators.push({ name: 'date' });
  }
  if (validators.length) p.validators = validators;
  return p;
}

function model(name) {
  const m = {};
  const chosen = new Set();
  const count = between(2, 5);
  while (chosen.size < count) chosen.add(pick(props));
  const properties = {};
  for (const prop of chosen) properties[prop[0]] = property(prop);
  if (properties.startDate && properties.endDate) {
    m.validators = [{ name: 'expression', id: 'END_AFTER_START', propertyNames: ['startDate', 'endDate'], context: { expression: '!model.startDate || !model.endDate || model.endDate >= model.startDate', messageTemplate: 'The end date must not be before the start date' } }];
  } else if (random() < 0.15) {
    m.condition = '!model.isDeleted';
  }
  m.properties = properties;
  return m;
}

const files = [];
for (const [area, names] of Object.entries(areas)) {
  const count = Math.min(names.length, between(15, 20));
  const doc = { $schema: 'https://raw.githubusercontent.com/Breeze/ideablade-validation/main/spec/validation-metadata.schema.json', $comment: `Test metadata: ${area}, generated by generate.cjs.` };
  if (area === 'sales') doc.global = { validators: ['breeze'] };
  for (const name of names.slice(0, count)) doc[name] = model(name);
  const file = `${area}.metadata.json`;
  fs.writeFileSync(path.join(dir, file), JSON.stringify(doc, null, 2) + '\n');
  files.push(file);
}

/** A TypeScript object literal for a map, in the style the editor writes (single quotes, unquoted keys). */
function ts(value, indent = '') {
  if (Array.isArray(value)) return `[${value.map((v) => ts(v, indent)).join(', ')}]`;
  if (value && typeof value === 'object') {
    const inner = indent + '  ';
    const entries = Object.entries(value).map(([k, v]) => `${inner}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${ts(v, inner)},`);
    return entries.length ? `{\n${entries.join('\n')}\n${indent}}` : '{}';
  }
  return typeof value === 'string' ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(value);
}

const viewModels = ['Search', 'Editor', 'Filter', 'Wizard', 'Summary', 'Import', 'Export', 'Dialog', 'Form', 'Panel'];
const tsFiles = [
  { file: 'client-sales.ts', maps: ['salesViewMetadata'] },
  { file: 'client-hr.ts', maps: ['hrViewMetadata', 'hrAdminMetadata'] },
  { file: 'client-admin.ts', maps: ['identityViewMetadata', 'tenantAdminMetadata', 'auditViewMetadata'] },
];
for (const { file, maps } of tsFiles) {
  const parts = [`import type { ModelValidationMetadataMap } from 'ideablade-validation';`];
  for (const map of maps) {
    const doc = {};
    const area = pick(Object.keys(areas));
    for (let i = 0, n = between(4, 8); i < n; i++) {
      const name = `${pick(areas[area])}${pick(viewModels)}`;
      if (!doc[name]) doc[name] = model(name);
    }
    parts.push(`/** View models: ${map}. */\nexport const ${map}: ModelValidationMetadataMap = ${ts(doc)};`);
  }
  fs.writeFileSync(path.join(dir, file), parts.join('\n\n') + '\n');
  files.push(file);
}

fs.writeFileSync(
  path.join(dir, 'large.ivproj'),
  JSON.stringify(
    {
      $comment: 'A large test project for the IdeaBlade Validation Editor, generated by generate.cjs: 10 JSON metadata files with 15-20 model types each, and 3 TypeScript files with 1-3 maps.',
      metadata: files,
      sources: [],
      otherValidators: [],
      camelCase: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${files.length} files and large.ivproj in ${dir}`);
