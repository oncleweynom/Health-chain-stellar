import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { ApprovalService } from '../approvals/approval.service';
import { InventoryService } from '../inventory/inventory.service';
import { SlaService } from '../sla/sla.service';
import { SlaStage } from '../sla/enums/sla-stage.enum';

import { OrderEntity } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import { OrderEventType } from './enums/order-event-type.enum';
import { OrdersService } from './orders.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { OrderFeeService } from './services/order-fee.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';

// ── Factories ─────────────────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<OrderEntity> = {}): OrderEntity =>
  ({
    id: 'order-1',
    hospitalId: 'hosp-1',
    bloodBankId: 'bank-1',
    bloodType: 'O+',
    quantity: 2,
    deliveryAddress: '123 Main St',
    status: OrderStatus.PENDING,
    riderId: null,
    disputeId: null,
    disputeReason: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OrderEntity);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockOrderRepo = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'order-new' })),
  save: jest.fn().mockImplementation((e) => Promise.resolve({ ...e, id: e.id ?? 'order-new' })),
  createQueryBuilder: jest.fn(),
};

const mockEventStore = {
  persistEvent: jest.fn().mockResolvedValue(undefined),
  replayOrderState: jest.fn().mockResolvedValue('PENDING'),
  getOrderHistory: jest.fn().mockResolvedValue([]),
};

const mockEventEmitter = { emit: jest.fn() };

const mockInventory = {
  reserveStockOrThrow: jest.fn().mockResolvedValue(undefined),
  restoreStockOrThrow: jest.fn().mockResolvedValue(undefined),
};

const mockRequestStatus = {
  applyStatusUpdate: jest.fn().mockResolvedValue({ nextStatus: OrderStatus.CONFIRMED }),
};

const mockOrderFee = {
  computeAndPersist: jest.fn().mockResolvedValue(undefined),
  preview: jest.fn().mockResolvedValue({ totalFee: 120 }),
};

const mockApproval = {
  createRequest: jest.fn().mockResolvedValue({ id: 'approval-1' }),
};

const mockSla = {
  startStage: jest.fn().mockResolvedValue(undefined),
};

const mockDataSource = {
  transaction: jest.fn().mockImplementation((cb: (m: any) => Promise<any>) =>
    cb({
      save: jest.fn().mockImplementation((_, e) => Promise.resolve(e)),
      getRepository: jest.fn(),
    }),
  ),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getRepositoryToken(OrderEntity), useValue: mockOrderRepo },
        { provide: OrderStateMachine, useValue: new OrderStateMachine() },
        { provide: OrderEventStoreService, useValue: mockEventStore },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: InventoryService, useValue: mockInventory },
        { provide: RequestStatusService, useValue: mockRequestStatus },
        { provide: OrderFeeService, useValue: mockOrderFee },
        { provide: ApprovalService, useValue: mockApproval },
        { provide: SlaService, useValue: mockSla },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all orders when no filters provided', async () => {
      mockOrderRepo.find.mockResolvedValue([makeOrder()]);
      const result = await service.findAll();
      expect(result.data).toHaveLength(1);
    });

    it('filters by status', async () => {
      mockOrderRepo.find.mockResolvedValue([]);
      await service.findAll('PENDING');
      expect(mockOrderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });

    it('filters by hospitalId', async () => {
      mockOrderRepo.find.mockResolvedValue([]);
      await service.findAll(undefined, 'hosp-1');
      expect(mockOrderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { hospitalId: 'hosp-1' } }),
      );
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the order when found', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      const result = await service.findOne('order-1');
      expect(result.data.id).toBe('order-1');
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      hospitalId: 'hosp-1',
      bloodBankId: 'bank-1',
      bloodType: 'O+',
      quantity: 2,
      deliveryAddress: '123 Main St',
    };

    it('throws BadRequestException when bloodBankId is missing', async () => {
      await expect(
        service.create({ ...dto, bloodBankId: undefined } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('reserves inventory before saving', async () => {
      mockOrderRepo.save.mockResolvedValue(makeOrder());
      await service.create(dto);
      expect(mockInventory.reserveStockOrThrow).toHaveBeenCalledWith('bank-1', 'O+', 2);
    });

    it('persists an ORDER_CREATED event', async () => {
      mockOrderRepo.save.mockResolvedValue(makeOrder());
      await service.create(dto);
      expect(mockEventStore.persistEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: OrderEventType.ORDER_CREATED }),
      );
    });

    it('starts TRIAGE SLA stage', async () => {
      mockOrderRepo.save.mockResolvedValue(makeOrder());
      await service.create(dto);
      expect(mockSla.startStage).toHaveBeenCalledWith(
        expect.any(String),
        SlaStage.TRIAGE,
        expect.any(Object),
      );
    });

    it('does not compute fees for PENDING status', async () => {
      mockOrderRepo.save.mockResolvedValue(makeOrder({ status: OrderStatus.PENDING }));
      await service.create(dto);
      expect(mockOrderFee.computeAndPersist).not.toHaveBeenCalled();
    });

    it('computes fees when order is CONFIRMED', async () => {
      mockOrderRepo.save.mockResolvedValue(makeOrder({ status: OrderStatus.CONFIRMED }));
      await service.create(dto);
      expect(mockOrderFee.computeAndPersist).toHaveBeenCalled();
    });
  });

  // ── updateStatus ────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(service.updateStatus('missing', 'CONFIRMED')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calls requestStatusService.applyStatusUpdate inside a transaction', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      await service.updateStatus('order-1', 'CONFIRMED', 'actor-1', 'ADMIN');
      expect(mockRequestStatus.applyStatusUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ status: 'CONFIRMED' }),
        'actor-1',
        'ADMIN',
        expect.any(Object),
      );
    });
  });

  // ── assignRider ─────────────────────────────────────────────────────────────

  describe('assignRider', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(service.assignRider('missing', 'rider-1')).rejects.toThrow(NotFoundException);
    });

    it('sets riderId and saves the order', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      await service.assignRider('order-1', 'rider-1');
      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ riderId: 'rider-1' }),
      );
    });

    it('emits order.rider.assigned event', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      await service.assignRider('order-1', 'rider-1');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'order.rider.assigned',
        expect.any(Object),
      );
    });

    it('starts DISPATCH_ACCEPTANCE SLA stage', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      await service.assignRider('order-1', 'rider-1');
      expect(mockSla.startStage).toHaveBeenCalledWith(
        'order-1',
        SlaStage.DISPATCH_ACCEPTANCE,
        expect.objectContaining({ riderId: 'rider-1' }),
      );
    });

    it('does not throw when SLA startStage fails', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      mockSla.startStage.mockRejectedValueOnce(new Error('SLA error'));
      await expect(service.assignRider('order-1', 'rider-1')).resolves.toBeDefined();
    });
  });

  // ── raiseDispute ────────────────────────────────────────────────────────────

  describe('raiseDispute', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(
        service.raiseDispute('missing', { reason: 'wrong item' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('transitions order to DISPUTED status', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.CONFIRMED }));
      mockOrderRepo.save.mockImplementation((e) => Promise.resolve(e));
      const result = await service.raiseDispute('order-1', { reason: 'wrong item' });
      expect(result.data.status).toBe(OrderStatus.DISPUTED);
    });

    it('persists ORDER_DISPUTED event', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.CONFIRMED }));
      mockOrderRepo.save.mockImplementation((e) => Promise.resolve(e));
      await service.raiseDispute('order-1', { reason: 'wrong item' });
      expect(mockEventStore.persistEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: OrderEventType.ORDER_DISPUTED }),
      );
    });

    it('emits order.disputed event', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.CONFIRMED }));
      mockOrderRepo.save.mockImplementation((e) => Promise.resolve(e));
      await service.raiseDispute('order-1', { reason: 'wrong item' });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('order.disputed', expect.any(Object));
    });
  });

  // ── resolveDispute ──────────────────────────────────────────────────────────

  describe('resolveDispute', () => {
    it('throws ConflictException when order is not DISPUTED', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.PENDING }));
      await expect(
        service.resolveDispute('order-1', { resolution: 'refund' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates an approval request for DISPUTED orders', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.DISPUTED }));
      const result = await service.resolveDispute(
        'order-1',
        { resolution: 'refund' },
        'actor-1',
      );
      expect(mockApproval.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requiredApprovals: 2 }),
      );
      expect(result.approvalRequestId).toBe('approval-1');
    });
  });

  // ── finalizeDisputeResolution ───────────────────────────────────────────────

  describe('finalizeDisputeResolution', () => {
    it('sets order status to RESOLVED', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.DISPUTED }));
      mockOrderRepo.save.mockImplementation((e) => Promise.resolve(e));
      await service.finalizeDisputeResolution('order-1', 'refund');
      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.RESOLVED }),
      );
    });

    it('persists ORDER_RESOLVED event', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.DISPUTED }));
      mockOrderRepo.save.mockImplementation((e) => Promise.resolve(e));
      await service.finalizeDisputeResolution('order-1', 'refund');
      expect(mockEventStore.persistEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: OrderEventType.ORDER_RESOLVED }),
      );
    });

    it('emits order.resolved event', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.DISPUTED }));
      mockOrderRepo.save.mockImplementation((e) => Promise.resolve(e));
      await service.finalizeDisputeResolution('order-1', 'refund');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('order.resolved', expect.any(Object));
    });
  });

  // ── previewOrderFees ────────────────────────────────────────────────────────

  describe('previewOrderFees', () => {
    it('throws NotFoundException when order does not exist', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null);
      await expect(service.previewOrderFees('missing', {})).rejects.toThrow(NotFoundException);
    });

    it('delegates to orderFeeService.preview', async () => {
      mockOrderRepo.findOne.mockResolvedValue(makeOrder());
      await service.previewOrderFees('order-1', { distanceKm: 20 });
      expect(mockOrderFee.preview).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ distanceKm: 20 }),
      );
    });
  });
});
