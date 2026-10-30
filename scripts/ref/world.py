"""Single source of truth for Caravan Road world parameters.
Used by the economy simulation and by the PDF build so every document agrees.
Money unit: fils. 1 dinar = 100 fils. 1 USDC = 10,000 fils = 100 dinar.
"""

GOODS = [
    dict(id="grain", fa="غله", base=1000, target=200),
    dict(id="salt", fa="نمک", base=1500, target=120),
    dict(id="iron", fa="آهن", base=4000, target=100),
    dict(id="spice", fa="ادویه", base=12000, target=40),
    dict(id="silk", fa="ابریشم", base=20000, target=30),
]

CITIES = [
    dict(id="dasht", fa="دشت", role="مزارع", prod={"grain": 8, "salt": 3}, cons={"iron": 2, "spice": 1, "silk": 1}),
    dict(id="madan", fa="معدن", role="کوهستان", prod={"iron": 4, "salt": 2}, cons={"grain": 4, "spice": 1, "silk": 1}),
    dict(id="bandar", fa="بندر", role="بندرگاه", prod={"spice": 4, "silk": 3}, cons={"grain": 3, "iron": 3, "salt": 2}),
    dict(id="shahr", fa="شهر", role="پایتخت", prod={"iron": 1}, cons={"grain": 1, "salt": 3, "spice": 2, "silk": 1}),
]

# (a, b, seconds, ambush risk in basis points)
ROUTES = [
    ("bandar", "shahr", 180, 800),
    ("shahr", "dasht", 240, 1200),
    ("dasht", "madan", 300, 1500),
    ("madan", "bandar", 360, 2000),
    ("bandar", "dasht", 270, 1000),
    ("shahr", "madan", 330, 1800),
]

PARAMS = dict(
    TICK_SECONDS=60,
    MULT_K_BP=4000,         # price sensitivity to scarcity
    MULT_MIN_BP=7500,       # price multiplier floor
    MULT_MAX_BP=13500,      # price multiplier ceiling
    STOCK_CAP_FACTOR=2,     # stock cap = 2 x target
    SPREAD_DEFAULT_BP=800,
    SPREAD_MIN_BP=400,
    SPREAD_MAX_BP=2000,
    BIAS_MIN_BP=-1500,
    BIAS_MAX_BP=1500,
    TRADE_FEE_BP=100,
    MAX_QTY_PER_TRADE=40,
    CARGO_CAP=40,
    GUARD_COST_BP=200,      # of cargo base value, per guard
    GUARD_RISK_FACTOR_BP=6500,
    MAX_GUARDS=3,
    AMBUSH_LOSS_BP=3000,
    MERCHANT_TREASURY_FILS=50000,   # 5 USDC
    FAUCET_FILS=50000,              # 500 dinar (PLAY only)
    MAX_DEPOSIT_FILS=200000,        # 20 USDC
    DAILY_WITHDRAW_CAP_FILS=100000, # 10 USDC
    STALL_FEE_BP=200,
)

GOOD = {g["id"]: g for g in GOODS}
CITY = {c["id"]: c for c in CITIES}


def tdiv(a, b):
    """Integer division truncating toward zero (same as Rust i128 and JS BigInt)."""
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def mult_bp(stock, target, p=PARAMS):
    m = 10000 + tdiv(p["MULT_K_BP"] * (target - stock), target)
    return max(p["MULT_MIN_BP"], min(p["MULT_MAX_BP"], m))


def quote(good_id, stock, spread_bp=None, bias_bp=0, p=PARAMS):
    g = GOOD[good_id]
    spread = p["SPREAD_DEFAULT_BP"] if spread_bp is None else spread_bp
    mid = g["base"] * mult_bp(stock, g["target"], p) // 10000
    mid = mid * (10000 + bias_bp) // 10000
    ask = mid * (10000 + spread // 2) // 10000
    bid = mid * (10000 - spread // 2) // 10000
    return bid, mid, ask

# automatic NPC arbitrage ("house caravans") keeps the world alive without players
PARAMS.update(NPC_SHIP_UNITS_PER_TICK=4, NPC_MIN_RATIO_GAP_BP=5000,
              REBALANCE_EXCESS_FROM_BP=15000, REBALANCE_PCT=30, HOUSE_RECYCLE_PCT=10)
