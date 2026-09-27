from fastapi import APIRouter

router = APIRouter()


@router.get("/ready", include_in_schema=False)
def ready() -> dict[str, str]:
    return {"status": "ready"}
