#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Env, Map,
    String, Vec,
};
use soroban_sdk::token;

// ── Types ──────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentStatus {
    Pending,
    Locked,
    Released,
    Refunded,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeReason {
    FailedDelivery,
    TemperatureExcursion,
    PaymentContested,
    WrongItem,
    DamagedGoods,
    LateDelivery,
    Other,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    pub id: u64,
    pub request_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub dispute_reason_code: Option<u32>,
    pub dispute_case_id: Option<String>,
    pub dispute_resolved: bool,
}

fn dispute_reason_to_code(reason: DisputeReason) -> u32 {
    match reason {
        DisputeReason::FailedDelivery => 1,
        DisputeReason::TemperatureExcursion => 2,
        DisputeReason::PaymentContested => 3,
        DisputeReason::WrongItem => 4,
        DisputeReason::DamagedGoods => 5,
        DisputeReason::LateDelivery => 6,
        DisputeReason::Other => 7,
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentStats {
    pub total_locked: i128,
    pub total_released: i128,
    pub total_refunded: i128,
    pub count_locked: u32,
    pub count_released: u32,
    pub count_refunded: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentPage {
    pub items: Vec<Payment>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DonationPledge {
    pub id: u64,
    pub donor: Address,
    pub amount_per_period: i128,
    pub interval_secs: u64,
    pub payee_pool: String,
    pub cause: String,
    pub region: String,
    pub emergency_pool: bool,
    pub active: bool,
    pub created_at: u64,
}

/// On-chain vesting schedule for donor reward tokens.
/// Enforces a cliff + linear vesting so donors cannot withdraw immediately.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingSchedule {
    /// Donor who will receive the vested tokens
    pub donor: Address,
    /// Total reward tokens to vest
    pub total_amount: i128,
    /// Ledger timestamp before which no tokens can be claimed
    pub cliff_timestamp: u64,
    /// Ledger timestamp at which 100% of tokens are vested
    pub vest_end_timestamp: u64,
    /// Amount already claimed by the donor
    pub claimed: i128,
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    PaymentNotFound = 500,
    InvalidAmount = 501,
    SamePayerPayee = 502,
    InvalidPage = 503,
    NotPledgeDonor = 504,
    InsufficientEscrowFunds = 505,
    Unauthorized = 506,
    ContractPaused = 507,
    /// Claim attempted before the cliff timestamp
    CliffNotReached = 508,
    /// Vesting schedule not found for this donor
    VestingNotFound = 509,
    /// No additional tokens are claimable at this time
    NothingToClaim = 510,
}

// ── Storage keys ───────────────────────────────────────────────────────────────

const PAYMENT_COUNTER: soroban_sdk::Symbol = symbol_short!("PAY_CTR");
const PLEDGE_COUNTER: soroban_sdk::Symbol = symbol_short!("PLG_CTR");
const ADMIN_KEY: soroban_sdk::Symbol = symbol_short!("ADMIN");
const PAUSED_KEY: soroban_sdk::Symbol = symbol_short!("PAUSED");
const REWARD_TOKEN_KEY: soroban_sdk::Symbol = symbol_short!("RWD_TOK");

fn payment_key(id: u64) -> (u64, &'static str) {
    (id, "pay")
}

fn pledge_key(id: u64) -> (u64, &'static str) {
    (id, "plg")
}

/// Persistent index: payer Address → Vec<u64> of payment IDs.
fn payer_index_key(payer: &Address) -> (Address, &'static str) {
    (payer.clone(), "pi")
}

/// Persistent index: payee Address → Vec<u64> of payment IDs.
fn payee_index_key(payee: &Address) -> (Address, &'static str) {
    (payee.clone(), "pyi")
}

/// Persistent index: PaymentStatus → Vec<u64> of payment IDs.
fn status_index_key(status: PaymentStatus) -> (u32, &'static str) {
    let code = match status {
        PaymentStatus::Pending => 0u32,
        PaymentStatus::Locked => 1,
        PaymentStatus::Released => 2,
        PaymentStatus::Refunded => 3,
        PaymentStatus::Disputed => 4,
        PaymentStatus::Cancelled => 5,
    };
    (code, "si")
}

fn get_counter(env: &Env) -> u64 {
    env.storage().instance().get(&PAYMENT_COUNTER).unwrap_or(0u64)
}

fn set_counter(env: &Env, val: u64) {
    env.storage().instance().set(&PAYMENT_COUNTER, &val);
}

fn get_pledge_counter(env: &Env) -> u64 {
    env.storage().instance().get(&PLEDGE_COUNTER).unwrap_or(0u64)
}

fn set_pledge_counter(env: &Env, val: u64) {
    env.storage().instance().set(&PLEDGE_COUNTER, &val);
}

fn store_payment(env: &Env, payment: &Payment) {
    env.storage().persistent().set(&payment_key(payment.id), payment);
}

fn load_payment(env: &Env, id: u64) -> Option<Payment> {
    env.storage().persistent().get(&payment_key(id))
}

fn store_pledge(env: &Env, pledge: &DonationPledge) {
    env.storage().persistent().set(&pledge_key(pledge.id), pledge);
}

fn load_pledge(env: &Env, id: u64) -> Option<DonationPledge> {
    env.storage().persistent().get(&pledge_key(id))
}

fn vesting_key(donor: &Address) -> (Address, &'static str) {
    (donor.clone(), "vest")
}

fn store_vesting(env: &Env, schedule: &VestingSchedule) {
    env.storage()
        .persistent()
        .set(&vesting_key(&schedule.donor), schedule);
}

fn load_vesting(env: &Env, donor: &Address) -> Option<VestingSchedule> {
    env.storage().persistent().get(&vesting_key(donor))
}

// ── Contract ───────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentContract;

#[contractimpl]
impl PaymentContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&ADMIN_KEY, &admin);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&ADMIN_KEY).ok_or(Error::Unauthorized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&PAUSED_KEY, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&ADMIN_KEY).ok_or(Error::Unauthorized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&PAUSED_KEY, &false);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED_KEY).unwrap_or(false)
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env.storage().instance().get(&PAUSED_KEY).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    pub fn create_payment(
        env: Env,
        request_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if payer == payee {
            return Err(Error::SamePayerPayee);
        }
        payer.require_auth();

        let id = get_counter(&env) + 1;
        set_counter(&env, id);

        let now = env.ledger().timestamp();
        let payment = Payment {
            id,
            request_id,
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            status: PaymentStatus::Pending,
            created_at: now,
            updated_at: now,
            dispute_reason_code: None,
            dispute_case_id: None,
            dispute_resolved: false,
        };

        store_payment(&env, &payment);
        // Maintain indexes — O(1) per index
        index_by_payer(&env, &payer, id);
        index_by_payee(&env, &payee, id);
        index_by_status(&env, PaymentStatus::Pending, id);
        index_by_request(&env, request_id, id);

        env.events().publish((symbol_short!("payment"), symbol_short!("created")), id);
        Ok(id)
    }

    /// Batch-create multiple payments in a single transaction.
    /// Each tuple is `(request_id, payer, payee, amount)`.
    /// Returns the Vec of new payment IDs in input order.
    pub fn batch_create_payments(
        env: Env,
        payments: Vec<(u64, Address, Address, i128)>,
    ) -> Result<Vec<u64>, Error> {
        Self::require_not_paused(&env)?;
        let mut ids: Vec<u64> = Vec::new(&env);
        for i in 0..payments.len() {
            let (request_id, payer, payee, amount) = payments.get(i).unwrap();
            let id = Self::create_payment(env.clone(), request_id, payer, payee, amount)?;
            ids.push_back(id);
        }
        Ok(ids)
    }

    pub fn create_escrow(
        env: Env,
        request_id: u64,
        hospital: Address,
        payee: Address,
        amount: i128,
        token: Address,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if hospital == payee {
            return Err(Error::SamePayerPayee);
        }
        hospital.require_auth();

        let token_client = token::Client::new(&env, &token);
        let available = token_client.balance(&hospital);
        if available < amount {
            return Err(Error::InsufficientEscrowFunds);
        }
        token_client.transfer(&hospital, &env.current_contract_address(), &amount);

        let id = get_counter(&env) + 1;
        set_counter(&env, id);

        let now = env.ledger().timestamp();
        let payment = Payment {
            id,
            request_id,
            payer: hospital.clone(),
            payee: payee.clone(),
            amount,
            status: PaymentStatus::Locked,
            created_at: now,
            updated_at: now,
            dispute_reason_code: None,
            dispute_case_id: None,
            dispute_resolved: false,
        };

        store_payment(&env, &payment);
        index_by_payer(&env, &hospital, id);
        index_by_payee(&env, &payee, id);
        index_by_status(&env, PaymentStatus::Locked, id);
        index_by_request(&env, request_id, id);
        // Update running stats for the initial Locked state
        update_stats_on_transition(&env, amount, PaymentStatus::Pending, PaymentStatus::Locked);

        env.events().publish((symbol_short!("payment"), symbol_short!("escrowed")), id);
        Ok(id)
    }

    pub fn update_status(env: Env, payment_id: u64, status: PaymentStatus) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        let old_status = payment.status;
        payment.status = status;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        // Keep status index consistent — O(n) remove + O(1) append
        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, status, payment_id);
        // Update running aggregate stats — O(1)
        update_stats_on_transition(&env, payment.amount, old_status, status);
        Ok(())
    }

    pub fn record_dispute(
        env: Env,
        payment_id: u64,
        reason: DisputeReason,
        case_id: String,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        let old_status = payment.status;
        payment.status = PaymentStatus::Disputed;
        payment.dispute_reason_code = Some(dispute_reason_to_code(reason));
        payment.dispute_case_id = Some(case_id.clone());
        payment.dispute_resolved = false;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Disputed, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Disputed);
        env.events().publish(
            (symbol_short!("payment"), symbol_short!("disputed")),
            (payment_id, case_id),
        );
        Ok(())
    }

    pub fn resolve_dispute(env: Env, payment_id: u64) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        if payment.dispute_case_id.is_some() {
            payment.dispute_resolved = true;
        }
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        env.events().publish(
            (symbol_short!("payment"), symbol_short!("resolved")),
            payment_id,
        );
        Ok(())
    }

    // ── Query functions — all O(1) index lookups or O(page_size) ──────────────

    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, Error> {
        load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)
    }

    /// O(1) lookup via request→payment index map.
    pub fn get_payment_by_request(env: Env, request_id: u64) -> Result<Payment, Error> {
        let map: Map<u64, u64> = env
            .storage()
            .instance()
            .get(&REQ_IDX)
            .unwrap_or(Map::new(&env));
        let payment_id = map.get(request_id).ok_or(Error::PaymentNotFound)?;
        load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)
    }

    /// O(page_size) — reads only the IDs in the requested page from the payer index.
    pub fn get_payments_by_payer(
        env: Env,
        payer: Address,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&payer_index_key(&payer))
            .unwrap_or(Vec::new(&env));
        Self::load_page(&env, ids, page, page_size)
    }

    /// O(page_size) — reads only the IDs in the requested page from the payee index.
    pub fn get_payments_by_payee(
        env: Env,
        payee: Address,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&payee_index_key(&payee))
            .unwrap_or(Vec::new(&env));
        Self::load_page(&env, ids, page, page_size)
    }

    /// O(page_size) — reads only the IDs in the requested page from the status index.
    pub fn get_payments_by_status(
        env: Env,
        status: PaymentStatus,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&status_index_key(status))
            .unwrap_or(Vec::new(&env));
        Self::load_page(&env, ids, page, page_size)
    }

    /// O(1) — reads pre-computed running totals, no scan required.
    pub fn get_payment_statistics(env: Env) -> PaymentStats {
        load_stats(&env)
    }

    /// O(page_size) — payments are stored in insertion order (monotone IDs),
    /// so the timeline is already sorted; no sort needed.
    pub fn get_payment_timeline(env: Env, page: u32, page_size: u32) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let total = get_counter(&env);
        let start = (page as u64) * (page_size as u64) + 1; // IDs are 1-based
        let end = (start + page_size as u64 - 1).min(total);

        let mut items: Vec<Payment> = Vec::new(&env);
        for id in start..=end {
            if let Some(p) = load_payment(&env, id) {
                items.push_back(p);
            }
        }
        PaymentPage { items, total, page, page_size }
    }

    pub fn get_payment_count(env: Env) -> u64 {
        get_counter(&env)
    }

    pub fn create_pledge(
        env: Env,
        donor: Address,
        amount_per_period: i128,
        interval_secs: u64,
        payee_pool: String,
        cause: String,
        region: String,
        emergency_pool: bool,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        donor.require_auth();
        if amount_per_period <= 0 {
            return Err(Error::InvalidAmount);
        }
        if interval_secs == 0 {
            return Err(Error::InvalidAmount);
        }

        let id = get_pledge_counter(&env) + 1;
        set_pledge_counter(&env, id);

        let pledge = DonationPledge {
            id,
            donor: donor.clone(),
            amount_per_period,
            interval_secs,
            payee_pool,
            cause,
            region,
            emergency_pool,
            active: true,
            created_at: env.ledger().timestamp(),
        };
        store_pledge(&env, &pledge);
        env.events().publish((symbol_short!("pledge"), symbol_short!("create")), id);
        Ok(id)
    }

    pub fn get_pledge(env: Env, pledge_id: u64) -> Result<DonationPledge, Error> {
        load_pledge(&env, pledge_id).ok_or(Error::PaymentNotFound)
    }

    pub fn set_pledge_active(
        env: Env,
        pledge_id: u64,
        donor: Address,
        active: bool,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        donor.require_auth();
        let mut p = load_pledge(&env, pledge_id).ok_or(Error::PaymentNotFound)?;
        if p.donor != donor {
            return Err(Error::NotPledgeDonor);
        }
        p.active = active;
        store_pledge(&env, &p);
        Ok(())
    }

    // ── Vesting ────────────────────────────────────────────────────────────────

    /// Create a vesting schedule for a donor's reward tokens. Admin only.
    ///
    /// Tokens vest linearly from `cliff_timestamp` to `vest_end_timestamp`.
    /// No tokens can be claimed before the cliff.
    ///
    /// # Arguments
    /// * `donor`         - Recipient of the vested tokens
    /// * `total_amount`  - Total reward tokens to vest
    /// * `cliff_secs`    - Seconds from now until the cliff
    /// * `duration_secs` - Total vesting duration in seconds (from now)
    ///
    /// # Errors
    /// - `Unauthorized`   - Caller is not the admin
    /// - `InvalidAmount`  - `total_amount` ≤ 0 or `duration_secs` = 0
    pub fn create_vesting(
        env: Env,
        admin: Address,
        donor: Address,
        total_amount: i128,
        cliff_secs: u64,
        duration_secs: u64,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::Unauthorized)?;
        if admin != stored_admin {
            return Err(Error::Unauthorized);
        }

        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if duration_secs == 0 {
            return Err(Error::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        let schedule = VestingSchedule {
            donor: donor.clone(),
            total_amount,
            cliff_timestamp: now + cliff_secs,
            vest_end_timestamp: now + duration_secs,
            claimed: 0,
        };

        store_vesting(&env, &schedule);

        env.events().publish(
            (symbol_short!("vest"), symbol_short!("created")),
            (donor, total_amount, now + cliff_secs, now + duration_secs),
        );

        Ok(())
    }

    /// Claim linearly vested tokens for the calling donor.
    ///
    /// Calculates the claimable amount at the current ledger time and transfers
    /// only that portion to the donor via the reward token contract.
    ///
    /// # Errors
    /// - `VestingNotFound`  - No schedule exists for this donor
    /// - `CliffNotReached`  - Current time is before the cliff timestamp
    /// - `NothingToClaim`   - All vested tokens have already been claimed
    pub fn claim_vested(env: Env, donor: Address, reward_token: Address) -> Result<i128, Error> {
        donor.require_auth();
        Self::require_not_paused(&env)?;

        let mut schedule = load_vesting(&env, &donor).ok_or(Error::VestingNotFound)?;

        let now = env.ledger().timestamp();

        if now < schedule.cliff_timestamp {
            return Err(Error::CliffNotReached);
        }

        // Linear vesting: vested = total * elapsed / duration
        let vested = if now >= schedule.vest_end_timestamp {
            schedule.total_amount
        } else {
            let elapsed = now - schedule.cliff_timestamp;
            let duration = schedule.vest_end_timestamp - schedule.cliff_timestamp;
            // Use i128 arithmetic; duration > 0 guaranteed by create_vesting
            (schedule.total_amount * elapsed as i128) / duration as i128
        };

        let claimable = vested - schedule.claimed;
        if claimable <= 0 {
            return Err(Error::NothingToClaim);
        }

        // Guard: donor can never claim more than total_amount across all claims
        let new_claimed = schedule.claimed + claimable;
        if new_claimed > schedule.total_amount {
            return Err(Error::NothingToClaim);
        }

        schedule.claimed = new_claimed;
        store_vesting(&env, &schedule);

        // Transfer claimable tokens from this contract to the donor
        let token_client = token::Client::new(&env, &reward_token);
        token_client.transfer(&env.current_contract_address(), &donor, &claimable);

        env.events().publish(
            (symbol_short!("vest"), symbol_short!("claimed")),
            (donor, claimable, new_claimed),
        );

        Ok(claimable)
    }

    /// Get the vesting schedule for a donor.
    pub fn get_vesting(env: Env, donor: Address) -> Result<VestingSchedule, Error> {
        load_vesting(&env, &donor).ok_or(Error::VestingNotFound)
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    /// Load a page of Payment records from a pre-built Vec<u64> of IDs.
    /// O(page_size) storage reads — no full scan.
    fn load_page(env: &Env, ids: Vec<u64>, page: u32, page_size: u32) -> PaymentPage {
        let total = ids.len() as u64;
        let start = (page as u64) * (page_size as u64);
        let mut items: Vec<Payment> = Vec::new(env);

        if start < total {
            let end = (start + page_size as u64).min(total);
            for i in start..end {
                let id = ids.get(i as u32).unwrap();
                if let Some(p) = load_payment(env, id) {
                    items.push_back(p);
                }
            }
        }

        PaymentPage { items, total, page, page_size }
    }
}

mod test;
