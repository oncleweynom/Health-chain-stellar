import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  BaseEntity,
} from 'typeorm';
import { BloodType } from '../enums/blood-type.enum';
import { BloodStatus } from '../enums/blood-status.enum';
import { BloodComponent } from '../enums/blood-component.enum';
import { BloodStatusHistory } from './blood-status-history.entity';

@Entity('blood_units')
@Index('idx_blood_units_blood_type', ['bloodType'])
@Index('idx_blood_units_status', ['status'])
@Index('idx_blood_units_organization', ['organizationId'])
@Index('idx_blood_units_expiry', ['expiresAt'])
export class BloodUnit extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'unit_code', type: 'varchar', unique: true })
  unitCode: string;

  @Column({
    name: 'blood_type',
    type: 'enum',
    enum: BloodType,
  })
  bloodType: BloodType;

  @Column({
    type: 'enum',
    enum: BloodStatus,
    default: BloodStatus.AVAILABLE,
  })
  status: BloodStatus;

  @Column({
    type: 'enum',
    enum: BloodComponent,
  })
  component: BloodComponent;

  @Column({ name: 'organization_id', type: 'varchar' })
  organizationId: string;

  @Column({ name: 'volume_ml', type: 'int' })
  volumeMl: number;

  @Column({ name: 'collected_at', type: 'timestamp' })
  collectedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'test_results', type: 'jsonb', nullable: true })
  testResults: Record<string, unknown> | null;

  @Column({ name: 'storage_temperature_celsius', type: 'float', nullable: true })
  storageTemperatureCelsius: number | null;

  @Column({ name: 'storage_location', type: 'varchar', nullable: true })
  storageLocation: string | null;

  @Column({ name: 'donor_id', type: 'varchar', nullable: true })
  donorId: string | null;

  @Column({ name: 'blockchain_unit_id', type: 'varchar', nullable: true })
  blockchainUnitId: string | null;

  @Column({ name: 'blockchain_tx_hash', type: 'varchar', nullable: true })
  blockchainTxHash: string | null;

  @OneToMany(() => BloodStatusHistory, (history) => history.bloodUnit, {
    cascade: true,
  })
  statusHistory: BloodStatusHistory[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
