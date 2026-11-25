import type { ModelValidationMetadataMap } from 'ideablade-validation';

/** View models: identityViewMetadata. */
export const identityViewMetadata: ModelValidationMetadataMap = {
  DepartmentForm: {
    properties: {
      notes: {
        maxLength: 2000,
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
      zipcode: {
        required: true,
        validators: [{
          name: 'zipCode',
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
    },
  },
  PerformanceReviewSearch: {
    properties: {
      amount: {
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }],
      },
      reference: {
        required: true,
        maxLength: 50,
      },
    },
  },
  EmergencyContactFilter: {
    properties: {
      reference: {
        maxLength: 2000,
      },
      email: {
        required: true,
        validators: [{
          name: 'email',
        }],
      },
      endDate: {
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  PositionSummary: {
    properties: {
      endDate: {
        validators: [{
          name: 'date',
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
    },
  },
  TrainingWizard: {
    properties: {
      name: {
        required: true,
        maxLength: 30,
      },
      email: {
        required: true,
        validators: [{
          name: 'email',
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
    },
  },
  LeaveRequestDialog: {
    properties: {
      name: {
        maxLength: 30,
      },
      status: {
        maxLength: 100,
      },
    },
  },
};

/** View models: tenantAdminMetadata. */
export const tenantAdminMetadata: ModelValidationMetadataMap = {
  KnowledgeArticleExport: {
    properties: {
      status: {
        required: true,
        maxLength: 2000,
      },
      priority: {
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }],
      },
      endDate: {
        validators: [{
          name: 'date',
        }],
      },
      description: {
        required: true,
        maxLength: 30,
      },
      notes: {
        required: true,
        maxLength: 250,
      },
    },
  },
  TicketCommentSearch: {
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
      reference: {
        maxLength: 2000,
      },
      startDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
      notes: {
        required: true,
        maxLength: 2000,
      },
      endDate: {
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  ServiceLevelForm: {
    properties: {
      phone: {
        validators: [{
          name: 'phone',
        }],
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
  HolidayForm: {
    properties: {
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
      amount: {
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
      startDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
      zipcode: {
        required: true,
        validators: [{
          name: 'zipCode',
        }],
      },
      notes: {
        required: true,
        maxLength: 100,
      },
    },
  },
};

/** View models: auditViewMetadata. */
export const auditViewMetadata: ModelValidationMetadataMap = {
  SupplierProductDialog: {
    properties: {
      description: {
        maxLength: 250,
      },
      name: {
        maxLength: 100,
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
      startDate: {
        required: true,
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  GoodsReceiptSummary: {
    properties: {
      description: {
        required: true,
        maxLength: 250,
      },
      email: {
        validators: [{
          name: 'email',
        }],
      },
      name: {
        required: true,
        maxLength: 2000,
      },
      status: {
        required: true,
        maxLength: 250,
      },
    },
  },
  BinExport: {
    properties: {
      quantity: {
        required: true,
        validators: [{
          name: 'numeric',
          context: {
            allowDecimals: true,
          },
        }],
      },
      endDate: {
        validators: [{
          name: 'date',
        }],
      },
    },
  },
  PurchaseOrderLineForm: {
    properties: {
      reference: {
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
      name: {
        maxLength: 250,
      },
    },
  },
  WarehouseExport: {
    properties: {
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
      notes: {
        maxLength: 100,
      },
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
      phone: {
        required: true,
        validators: [{
          name: 'phone',
        }],
      },
    },
  },
};
