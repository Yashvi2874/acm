"""
Physical constants for orbital simulation.
All other modules must import from here — never hardcode these values.
"""

MU = 398600.4418   # Earth's standard gravitational parameter, km³/s²
R_E = 6378.137     # Earth's equatorial radius, km
J2 = 1.08263e-3    # Earth's second zonal harmonic coefficient (dimensionless)

# Propulsion system constants
DRY_MASS_KG = 500.0        # Satellite dry mass (kg)
INITIAL_FUEL_KG = 50.0      # Initial propellant mass (kg)
INITIAL_TOTAL_MASS_KG = DRY_MASS_KG + INITIAL_FUEL_KG  # 550.0 kg
SPECIFIC_IMPULSE_S = 300.0  # Isp in seconds
G0 = 9.80665e-3             # Standard gravity in km/s²
MAX_DELTA_V_PER_BURN_KMS = 0.015  # Maximum |Δv| per burn (15 m/s = 0.015 km/s)
BURN_COOLDOWN_S = 600      # Mandatory cooldown between burns (seconds)
STATION_KEEP_KM = 10.0     # Station-keeping radius (km) to stay nominal
