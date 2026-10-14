from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.icp import DEFAULT_WEIGHTS, ICPProfile
from app.schemas.icp import ICPIn, ICPOut
from app.services import leads as svc

router = APIRouter(prefix="/icp", tags=["icp"])


@router.get("", response_model=ICPOut)
def get_icp(db: Session = Depends(get_db)) -> ICPProfile:
    return svc.get_icp(db)


@router.put("", response_model=ICPOut)
def update_icp(payload: ICPIn, db: Session = Depends(get_db)) -> ICPProfile:
    icp = svc.get_icp(db)
    for field, value in payload.model_dump().items():
        setattr(icp, field, value)
    db.commit()
    svc.rescore_all(db)  # every lead re-ranks instantly against the new profile
    db.refresh(icp)
    return icp


@router.get("/defaults")
def default_weights() -> dict[str, int]:
    return DEFAULT_WEIGHTS
