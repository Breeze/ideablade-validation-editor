import type { ModelValidationMetadataMap } from 'ideablade-validation';

/** View models: hrViewMetadata. */
export const hrViewMetadata: ModelValidationMetadataMap = {
  SalesOrderLineSummary: {
    properties: {
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
      startDate: {
        validators: [{
          name: 'date',
        }],
      },
      description: {
        required: true,
        maxLength: 100,
      },
      quantity: {
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }],
      },
      amount: {
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
    },
  },
  QuoteLineEditor: {
    properties: {
      phone: {
        validators: [{
          name: 'phone',
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
  ContractWizard: {
    properties: {
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
      description: {
        required: true,
        maxLength: 50,
      },
    },
  },
  PriceListItemSearch: {
    properties: {
      endDate: {
        validators: [{
          name: 'date',
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
      phone: {
        required: true,
        validators: [{
          name: 'phone',
        }],
      },
      amount: {
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
      name: {
        required: true,
        maxLength: 100,
      },
    },
  },
  CampaignSummary: {
    properties: {
      description: {
        maxLength: 100,
      },
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
      priority: {
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
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
  OpportunityFilter: {
    properties: {
      email: {
        required: true,
        validators: [{
          name: 'email',
        }],
      },
      status: {
        maxLength: 250,
      },
    },
  },
  QuotePanel: {
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
      status: {
        required: true,
        maxLength: 30,
      },
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
    },
  },
  PriceListItemSummary: {
    properties: {
      status: {
        maxLength: 2000,
      },
      zipcode: {
        validators: [{
          name: 'zipCode',
        }],
      },
      notes: {
        maxLength: 250,
      },
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
      email: {
        validators: [{
          name: 'email',
        }],
      },
    },
  },
};

/** View models: hrAdminMetadata. */
export const hrAdminMetadata: ModelValidationMetadataMap = {
  AuditEntrySearch: {
    properties: {
      priority: {
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
      status: {
        required: true,
        maxLength: 250,
      },
      notes: {
        required: true,
        maxLength: 30,
      },
      reference: {
        maxLength: 50,
      },
      startDate: {
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  UserProfileExport: {
    properties: {
      name: {
        maxLength: 100,
      },
      reference: {
        required: true,
        maxLength: 30,
      },
      amount: {
        required: true,
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }],
      },
      status: {
        required: true,
        maxLength: 30,
      },
    },
  },
  TenantFilter: {
    properties: {
      description: {
        maxLength: 100,
      },
      notes: {
        maxLength: 50,
      },
      startDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  ApiKeyExport: {
    properties: {
      startDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
      description: {
        required: true,
        maxLength: 100,
      },
    },
  },
  UserProfileEditor: {
    properties: {
      zipcode: {
        validators: [{
          name: 'zipCode',
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
      endDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
      description: {
        required: true,
        maxLength: 250,
      },
    },
  },
  RolePanel: {
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
      priority: {
        required: true,
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }],
      },
    },
  },
  ApiKeyPanel: {
    properties: {
      name: {
        required: true,
        maxLength: 2000,
      },
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
    },
  },
  TenantSettingDialog: {
    properties: {
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
      endDate: {
        validators: [{
          name: 'date',
        }],
      },
      email: {
        validators: [{
          name: 'email',
        }],
      },
      reference: {
        required: true,
        maxLength: 30,
      },
      priority: {
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
    },
  },
};
