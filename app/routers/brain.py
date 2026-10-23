"""User-owned persistent graph storage for Second Brain."""
from __future__ import annotations
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ..deps import get_current_user, get_db, require_csrf
from ..models import BrainGraph, User

router=APIRouter(prefix="/api/brain-graph",tags=["second-brain"])


@router.get("")
async def get_graph(user: User=Depends(get_current_user),db: AsyncSession=Depends(get_db)):
    row=(await db.execute(select(BrainGraph).where(BrainGraph.user_id==user.id))).scalars().first()
    if row is None: return {"graph":{"version":1,"nodes":[],"edges":[]},"updated_at":None}
    try: graph=json.loads(row.graph_json or "{}")
    except (ValueError,TypeError): graph={"version":1,"nodes":[],"edges":[]}
    if not isinstance(graph,dict): graph={"version":1,"nodes":[],"edges":[]}
    return {"graph":graph,"updated_at":row.updated_at.isoformat() if row.updated_at else None}


@router.put("")
async def save_graph(data: dict,_csrf=Depends(require_csrf),user: User=Depends(get_current_user),db: AsyncSession=Depends(get_db)):
    graph=data.get("graph") if isinstance(data,dict) else None
    if not isinstance(graph,dict): raise HTTPException(status.HTTP_400_BAD_REQUEST,"Ожидался объект graph")
    nodes,edges=graph.get("nodes"),graph.get("edges")
    if not isinstance(nodes,list) or not isinstance(edges,list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,"В схеме нужны массивы nodes и edges")
    if len(nodes)>50 or len(edges)>120:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,"Слишком много блоков или связей")
    encoded=json.dumps(graph,ensure_ascii=False,separators=(",",":"))
    if len(encoded.encode("utf-8"))>100_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,"Схема не должна превышать 100 КБ")
    row=(await db.execute(select(BrainGraph).where(BrainGraph.user_id==user.id))).scalars().first()
    if row is None:
        row=BrainGraph(user_id=user.id,graph_json=encoded); db.add(row)
    else: row.graph_json=encoded
    await db.commit(); await db.refresh(row)
    return {"ok":True,"updated_at":row.updated_at.isoformat() if row.updated_at else None}
