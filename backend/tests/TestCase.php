<?php

namespace Tests;

use Database\Factories\BookshopFactory;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /** The bookshop that factory-made users and branches join by default. */
    protected function tenantId(): int
    {
        return BookshopFactory::defaultId();
    }
}
