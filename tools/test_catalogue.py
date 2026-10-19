"""
Which catalogue products the workshop sells, and that the repo carries images for those only.

The first tests need nothing; the rest read the catalogue and the committed images from the
repo (`make test` mounts it at /workspace) and are skipped when it is not there.
"""

import re

import pytest

import seed_postgres as sp


def _entry(**kw):
    return {"id": 1, **kw}


def test_a_product_must_pass_all_three_tests():
    images = {1}
    assert sp.is_active_product(_entry(is_active=True), images)
    assert not sp.is_active_product(_entry(is_active=False), images)               # the catalogue says no
    assert not sp.is_active_product(_entry(is_active=True, flagged_for_deletion=True), images)
    assert not sp.is_active_product(_entry(is_active=True), set())                  # no photo
    assert not sp.is_active_product({"id": 1}, images)                              # no is_active at all


repo = pytest.mark.skipif(
    not (sp.CATALOG_PATH.exists() and sp.IMAGES_DIR.exists()), reason="the repo is not mounted"
)


@repo
def test_the_repo_has_an_image_for_every_active_product_and_for_nothing_else():
    entries = sp.load_catalog()
    images = sp.image_ids()
    wanted = {e["id"] for e in entries if e.get("is_active") and not e.get("flagged_for_deletion")}
    stray = images - wanted
    assert not stray, f"images of {len(stray)} deactivated products are in the repo, e.g. {sorted(stray)[:5]}"
    active = {e["id"] for e in entries if sp.is_active_product(e, images)}
    assert active == images, "a product that is active in the catalogue has no image"


@repo
def test_no_image_file_is_left_over_that_the_catalogue_does_not_know():
    known = {e["id"] for e in sp.load_catalog()}
    assert sp.image_ids() <= known


@repo
def test_the_images_the_storefront_names_are_there():
    # constants.ts points each category's hero at a product photo by id.
    source = (sp.ROOT / "frontend" / "src" / "lib" / "constants.ts").read_text()
    hero_ids = {int(i) for i in re.findall(r"/images/(\d+)\.webp", source)}
    assert hero_ids and hero_ids <= sp.image_ids()


@repo
def test_every_category_keeps_enough_products_to_browse():
    entries = sp.load_catalog()
    images = sp.image_ids()
    per_category: dict[str, int] = {}
    for e in entries:
        if sp.is_active_product(e, images):
            per_category[e["product_category"]] = per_category.get(e["product_category"], 0) + 1
    assert set(per_category) == {e["product_category"] for e in entries}
    # a category page shows 12; the simulator pages a few deep
    assert min(per_category.values()) >= 36, per_category
