"""Simulation Mode endpoints.

Thin control surface over `simulation_engine`. These only toggle / report the
simulator; readings themselves travel the normal sensor path (Reading model,
WebSocket broadcast, proactive alerts) so the dashboard needs no special
handling and swapping in a real node later changes nothing here.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import SimulationState
from app.services.simulation_service import SIM_SOURCE, simulation_engine

router = APIRouter(prefix="/simulation", tags=["simulation"])


def _state() -> SimulationState:
    return SimulationState(**simulation_engine.status())


@router.get("/status", response_model=SimulationState)
def simulation_status(_user: User = Depends(get_current_user)) -> SimulationState:
    return _state()


@router.post("/start", response_model=SimulationState)
async def start_simulation(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SimulationState:
    """Turn Simulation Mode ON. Safe to call repeatedly (idempotent)."""
    # Pass the caller so the "Tomato Demo" plant is owned by them and visible
    # in their plant list / readings endpoints.
    await simulation_engine.start(db, user_id=user.id)
    return _state()


@router.post("/stop", response_model=SimulationState)
async def stop_simulation(_user: User = Depends(get_current_user)) -> SimulationState:
    """Turn Simulation Mode OFF. Existing readings/history are preserved."""
    await simulation_engine.stop()
    return _state()


__all__ = ["router", "SIM_SOURCE"]
