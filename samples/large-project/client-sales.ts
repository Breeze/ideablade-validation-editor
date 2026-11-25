import type { ModelValidationMetadataMap } from 'ideablade-validation';

/** View models: salesViewMetadata. */
export const salesViewMetadata: ModelValidationMetadataMap = {
  ExpenseReportFilter: {
    condition: '!model.isDeleted',
    properties: {
      quantity: {
        required: true,
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }, {
          name: 'range',
          context: {
            minValue: 0,
          },
        }],
      },
      url: {
        validators: [{
          name: 'pattern',
          id: 'URL_FORMAT',
          context: {
            expression: '^https?://\\S+$',
            flags: 'i',
            messageTemplate: '\'%displayName%\' must be a web address',
          },
        }],
      },
      startDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  TimeEntryDialog: {
    properties: {
      notes: {
        required: true,
        maxLength: 30,
      },
      email: {
        required: true,
        validators: [{
          name: 'email',
        }],
      },
      endDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
      url: {
        required: true,
        validators: [{
          name: 'pattern',
          id: 'URL_FORMAT',
          context: {
            expression: '^https?://\\S+$',
            flags: 'i',
            messageTemplate: '\'%displayName%\' must be a web address',
          },
        }],
      },
    },
  },
  TaskDependencyExport: {
    validators: [{
      name: 'expression',
      id: 'END_AFTER_START',
      propertyNames: ['startDate', 'endDate'],
      context: {
        expression: '!model.startDate || !model.endDate || model.endDate >= model.startDate',
        messageTemplate: 'The end date must not be before the start date',
      },
    }],
    properties: {
      name: {
        required: true,
        maxLength: 30,
      },
      notes: {
        maxLength: 250,
      },
      endDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
      code: {
        validators: [{
          name: 'pattern',
          id: 'CODE_FORMAT',
          context: {
            expression: '^[A-Z]{2,4}-\\d{3,6}$',
            messageTemplate: '\'%displayName%\' must look like AB-123',
          },
        }],
      },
      startDate: {
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  ProjectPhaseDialog: {
    properties: {
      code: {
        required: true,
        validators: [{
          name: 'pattern',
          id: 'CODE_FORMAT',
          context: {
            expression: '^[A-Z]{2,4}-\\d{3,6}$',
            messageTemplate: '\'%displayName%\' must look like AB-123',
          },
        }],
      },
      percentage: {
        required: true,
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }, {
          name: 'range',
          context: {
            minValue: 0,
            maxValue: 100,
          },
        }],
      },
      zipcode: {
        validators: [{
          name: 'zipCode',
        }],
      },
      name: {
        required: true,
        maxLength: 100,
      },
      status: {
        required: true,
        maxLength: 100,
      },
    },
  },
  ExpenseEditor: {
    properties: {
      phone: {
        required: true,
        validators: [{
          name: 'phone',
        }],
      },
      reference: {
        maxLength: 50,
      },
    },
  },
  TaskImport: {
    properties: {
      status: {
        maxLength: 250,
      },
      reference: {
        required: true,
        maxLength: 100,
      },
    },
  },
  IssueImport: {
    properties: {
      priority: {
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }, {
          name: 'range',
          context: {
            minValue: 0,
          },
        }],
      },
      percentage: {
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }, {
          name: 'range',
          context: {
            minValue: 0,
            maxValue: 100,
          },
        }],
      },
      name: {
        required: true,
        maxLength: 2000,
      },
    },
  },
};
